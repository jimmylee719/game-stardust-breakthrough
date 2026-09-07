// 端對端連線測試：起伺服器 → 兩個客戶端加入同一房 → 房主開始 → B 移動 → 驗證 A 看得到 B。
// 用法：node test/net.js
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 18765 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
const fail = msg => { console.error('FAIL:', msg); server.kill(); process.exit(1); };

await new Promise(resolve => server.stdout.on('data', d => { if (String(d).includes('server →')) resolve(); }));

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, name, id: null, code: null, lobby: null, snaps: [], events: [], errors: [], send: m => ws.send(JSON.stringify(m)) };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { c.id = m.id; c.code = m.code; }
    else if (m.t === 'lobby') c.lobby = m;
    else if (m.t === 'snap') { c.snaps.push(m.s); if (m.ev) c.events.push(...m.ev); }
    else if (m.t === 'error') c.errors.push(m.msg);
  });
  c.open = new Promise(r => ws.on('open', r));
  return c;
}

const A = client('Alice');
await A.open; A.send({ t: 'join', name: 'Alice' });
await wait(150);
if (!A.code) fail('A 沒收到 welcome / 房號');
console.log('A joined room', A.code, 'as id', A.id);

const B = client('Bob');
await B.open; B.send({ t: 'join', name: 'Bob', code: A.code });
await wait(150);
if (B.code !== A.code) fail('B 沒加入同一房');
if (!A.lobby || A.lobby.players.length !== 2) fail(`A 的大廳應有 2 人，實際 ${A.lobby?.players.length}`);
if (A.lobby.hostId !== A.id) fail('房主應為 A');
console.log('lobby:', A.lobby.players.map(p => p.name).join(', '), '| host =', A.lobby.hostId);

// 非房主嘗試開始 → 應被忽略
B.send({ t: 'start' }); await wait(150);
if (A.snaps.length) fail('非房主不該能開始遊戲');

A.send({ t: 'start' }); await wait(300);
if (!A.snaps.length || !B.snaps.length) fail('開始後應收到快照');
const first = B.snaps[0];
if (first.players.length !== 2) fail('快照應包含 2 名玩家');
const bobStart = first.players.find(p => p.id === B.id);
console.log('first snap: scene', first.scene, '| players', first.players.map(p => `${p.name}@${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' '));

// B 往右走並開火 1 秒
const t0 = Date.now();
const iv = setInterval(() => B.send({ t: 'input', ix: 1, iy: 0, angle: 0, fire: true, dash: false }), 33);
await wait(1000); clearInterval(iv);
const lastA = A.snaps[A.snaps.length - 1];
const bobNow = lastA.players.find(p => p.id === B.id);
if (!bobNow) fail('A 的快照裡找不到 Bob');
if (bobNow.x - bobStart.x < 100) fail(`Bob 應向右移動，位移只有 ${(bobNow.x - bobStart.x).toFixed(0)}`);
if (!lastA.bullets.length && !A.events.some(e => e[0] === 'muzzle')) fail('Bob 開火後應出現子彈或槍口事件');
const rate = A.snaps.length / ((Date.now() - t0 + 300) / 1000);
console.log(`Bob moved ${(bobNow.x - bobStart.x).toFixed(0)}px right | bullets in snap: ${lastA.bullets.length} | A got ${A.snaps.length} snaps (~${rate.toFixed(0)}/s) | fx events: ${A.events.length}`);

// 本機限定事件應帶 pid；全域事件 pid 為 null
const local = A.events.filter(e => e[1] !== null), global = A.events.filter(e => e[1] === null);
console.log(`events: ${global.length} global, ${local.length} player-scoped`);

// B 離開 → A 的大廳更新為 1 人
B.ws.close(); await wait(200);
if (!A.lobby || A.lobby.players.length !== 1) fail('B 離開後 A 的名單應剩 1 人');
console.log('after Bob left: lobby =', A.lobby.players.map(p => p.name).join(', '));

// 加入不存在的房間 → error
const C = client('Carl'); await C.open; C.send({ t: 'join', name: 'Carl', code: 'ZZZZ' }); await wait(150);
if (!C.errors.length) fail('加入不存在的房間應回 error');
console.log('join bad room →', C.errors[0]);

console.log('PASS');
A.ws.close(); C.ws.close(); server.kill(); process.exit(0);
