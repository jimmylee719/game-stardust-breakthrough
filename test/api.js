// REST API 與合作成績記錄測試：起伺服器（JSON 檔存放在暫存目錄）→ 註冊 → 上傳單人成績 → 排行榜 → 合作局結束自動記錄。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';

const PORT = 19765 + Math.floor(Math.random() * 1000);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-'));
// 讓測試用獨立的資料檔（DATA_DIR 指到暫存目錄）
const server = spawn(process.execPath, [path.resolve('server/index.js')], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', DATA_DIR: tmp }, stdio: ['ignore', 'pipe', 'inherit'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
const fail = msg => { console.error('FAIL:', msg); server.kill(); process.exit(1); };
await new Promise(resolve => server.stdout.on('data', d => { if (String(d).includes('server →')) resolve(); }));
const base = `http://localhost:${PORT}`;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const get = p => fetch(base + p).then(r => r.json());

const a = await post('/api/register', { name: '測試員A' });
if (!a.id || !a.secret) fail('register 應回 id/secret');
const b = await post('/api/register', { name: '測試員B' });
console.log('registered', a.id, b.id);

const bad = await post('/api/runs', { id: a.id, secret: 'wrong', score: 999, wave: 3 });
if (!bad.error) fail('錯誤 secret 應被拒絕');

const r1 = await post('/api/runs', { id: a.id, secret: a.secret, score: 1500, wave: 6 });
const r2 = await post('/api/runs', { id: b.id, secret: b.secret, score: 2200, wave: 8 });
const r3 = await post('/api/runs', { id: a.id, secret: a.secret, score: 800, wave: 4 });
if (r1.rank !== 1 || r2.rank !== 1 || r3.rank !== 3) fail(`排名計算錯誤：${r1.rank},${r2.rank},${r3.rank}`);
console.log('solo runs ranked', r1.rank, r2.rank, r3.rank);

const lbAll = await get('/api/leaderboard?mode=solo&period=all');
if (lbAll.rows.length !== 3 || lbAll.rows[0].score !== 2200 || lbAll.rows[0].party[0].name !== '測試員B') fail('排行榜排序錯誤');
const lbWeek = await get('/api/leaderboard?mode=solo&period=week');
if (lbWeek.rows.length !== 3) fail('本週榜應包含剛上傳的成績');
console.log('leaderboard top:', lbAll.rows.map(r => `${r.party[0].name}:${r.score}`).join(' '));

await post('/api/rename', { id: a.id, secret: a.secret, name: '改名A' });
const me = await get(`/api/me?id=${a.id}&secret=${encodeURIComponent(a.secret)}`);
if (me.name !== '改名A' || me.stats.solo.best !== 1500 || me.stats.solo.runs !== 2 || me.stats.solo.rank !== 2) fail('me 統計錯誤 ' + JSON.stringify(me));
console.log('me:', me.name, me.stats.solo);

// 合作：兩人進房、開局、全員陣亡 → 伺服器記錄 coop 成績並廣播 result
function client(name, acct) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, msgs: [], snaps: [] };
  ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (m.t === 'snap') c.snaps.push(m.s); if (m.t === 'welcome') c.w = m; if (m.t === 'result') c.result = m; });
  c.open = new Promise(r => ws.on('open', r));
  c.join = code => ws.send(JSON.stringify({ t: 'join', name, code, acct }));
  return c;
}
const A = client('改名A', { id: a.id, secret: a.secret }); await A.open; A.join(); await wait(200);
const B = client('測試員B', { id: b.id, secret: b.secret }); await B.open; B.join(A.w.code); await wait(200);
A.ws.send(JSON.stringify({ t: 'start' })); await wait(300);
// 前 10 秒對最近的敵人做預判射擊拿分數（零分局不記錄），之後停火站著被打到全員倒地 → gameover
let seq = 0;
let t0 = Date.now();
const iv = setInterval(() => {
  for (const c of [A, B]) {
    const s = c.snaps.at(-1); if (!s) continue;
    const me = s.players.find(p => p.id === c.w.id); if (!me) continue;
    const tgt = s.enemies[0] || s.boss;
    let angle = 0;
    if (tgt) { const tl = Math.hypot(tgt.x - me.x, tgt.y - me.y) / 760; angle = Math.atan2(tgt.y + (tgt.vy || 0) * tl - me.y, tgt.x + (tgt.vx || 0) * tl - me.x); }
    c.ws.send(JSON.stringify({ t: 'input', seq: ++seq, ix: 0, iy: 0, angle, fire: Date.now() - t0 < 10000, dash: false }));
  }
}, 40);
while (!A.result && Date.now() - t0 < 60000) await wait(200);
clearInterval(iv);
if (!A.result) fail('合作局結束後應收到 result（等了 60 秒）');
console.log('coop result:', A.result);
const coop = await get('/api/leaderboard?mode=coop&period=all');
if (coop.rows.length !== 1 || coop.rows[0].party.length !== 2 || !coop.rows[0].party.some(p => p.id === a.id)) fail('合作榜應有一筆兩人成績並帶帳號 id: ' + JSON.stringify(coop.rows));
console.log('coop leaderboard:', coop.rows[0].party.map(p => p.name).join(' + '), coop.rows[0].score);

console.log('PASS');
A.ws.close(); B.ws.close(); server.kill(); process.exit(0);
