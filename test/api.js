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

// 星塵：每局依分數與波次發放（1500/w6 → 90，800/w4 → 52）；永久強化用星塵購買
if (me.dust !== 142) fail('星塵應為 142，得到 ' + me.dust);
const noMoney = await post('/api/perks/buy', { id: a.id, secret: a.secret, perk: 'magnet' });
if (noMoney.error !== 'not enough dust') fail('星塵不足應被拒絕：' + JSON.stringify(noMoney));
const r4 = await post('/api/runs', { id: a.id, secret: a.secret, score: 5000, wave: 10 });
if (r4.dust !== 250 || r4.total !== 392) fail('第三局星塵錯誤 ' + JSON.stringify(r4));
const bought = await post('/api/perks/buy', { id: a.id, secret: a.secret, perk: 'magnet' });
if (!bought.ok || bought.dust !== 142 || bought.unlocks.join() !== 'magnet') fail('購買失敗 ' + JSON.stringify(bought));
const badPerk = await post('/api/perks/buy', { id: a.id, secret: a.secret, perk: 'nope' });
if (!badPerk.error) fail('未知強化應被拒絕');
const lowRun = await post('/api/runs', { id: a.id, secret: a.secret, score: 3, wave: 1 });
if (lowRun.rank !== null || lowRun.dust !== 5) fail('低分局不上榜但仍給星塵 ' + JSON.stringify(lowRun));
console.log('dust & perks ok:', bought.dust, bought.unlocks);

// 每日挑戰：今天規則固定、一天一次、獨立榜
const d0 = await get(`/api/daily?id=${a.id}&secret=${encodeURIComponent(a.secret)}`);
if (d0.mods.length !== 2 || d0.started || d0.run) fail('每日挑戰初始狀態錯誤 ' + JSON.stringify(d0));
const ds = await post('/api/daily/start', { id: a.id, secret: a.secret });
if (!ds.ok || ds.seed !== d0.seed) fail('開始每日挑戰失敗 ' + JSON.stringify(ds));
const ds2 = await post('/api/daily/start', { id: a.id, secret: a.secret });
if (ds2.error !== 'daily already played') fail('每日挑戰應只能開始一次');
const dr = await post('/api/runs', { id: a.id, secret: a.secret, score: 300, wave: 3, mode: 'daily', day: d0.key });
if (dr.rank !== 1 || dr.mode !== 'daily') fail('每日成績錯誤 ' + JSON.stringify(dr));
const dr2 = await post('/api/runs', { id: a.id, secret: a.secret, score: 999, wave: 9, mode: 'daily', day: d0.key });
if (dr2.error !== 'daily already played') fail('每日成績應只能上傳一次');
const dlb = await get('/api/leaderboard?mode=daily');
if (dlb.rows.length !== 1 || dlb.rows[0].score !== 300 || dlb.day !== d0.key) fail('每日榜錯誤 ' + JSON.stringify(dlb));
const solo2 = await get('/api/leaderboard?mode=solo&period=all');
if (solo2.rows.some(r => r.score === 300)) fail('每日成績不該混進單人榜');
const d1 = await get(`/api/daily?id=${a.id}&secret=${encodeURIComponent(a.secret)}`);
if (!d1.run || d1.run.rank !== 1) fail('每日狀態應顯示已完成 ' + JSON.stringify(d1));
console.log('daily ok:', d0.key, d0.mods.join('+'), 'rank', dr.rank);

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
if (!A.result.dustBy || !(A.result.dustBy[a.id] > 0)) fail('合作局應發星塵給有帳號的隊員 ' + JSON.stringify(A.result));
const coop = await get('/api/leaderboard?mode=coop&period=all');
if (coop.rows.length !== 1 || coop.rows[0].party.length !== 2 || !coop.rows[0].party.some(p => p.id === a.id)) fail('合作榜應有一筆兩人成績並帶帳號 id: ' + JSON.stringify(coop.rows));
console.log('coop leaderboard:', coop.rows[0].party.map(p => p.name).join(' + '), coop.rows[0].score);

console.log('PASS');
A.ws.close(); B.ws.close(); server.kill(); process.exit(0);
