// 遊戲伺服器：靜態檔 + WebSocket 房間。
// 每個房間持有一個權威 world，以 TICK_RATE 跑 game.js 的 update()，
// 每 tick 廣播快照與 fx 事件；客戶端只送輸入。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createWorld, addPlayer, startRun, update, chooseUpgrade, NULL_FX } from '../public/js/game.js';
import { snapshotWorld } from '../shared/snapshot.js';
import { TICK_RATE, MAX_PLAYERS, sanitizeName } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = Number(process.env.PORT) || 8765;

// ---------- 靜態檔 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
function resolveFile(urlPath) {
  let base = PUBLIC, rel = urlPath;
  if (urlPath === '/shared' || urlPath.startsWith('/shared/')) { base = SHARED; rel = urlPath.slice('/shared'.length); }
  if (rel === '' || rel === '/') rel = '/index.html';
  const abs = path.normalize(path.join(base, rel));
  if (!abs.startsWith(base)) return null;
  return abs;
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size })); return; }
  const file = resolveFile(decodeURIComponent(url.pathname));
  if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------- 房間 ----------
const rooms = new Map(); // code -> room
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeRoomCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join(''); } while (rooms.has(code));
  return code;
}

/** 伺服器端的 fx：把每次呼叫記成事件，tick 結束時隨快照廣播。pid 為 null 表示所有人都播放。 */
function makeRecorder(events) {
  const mk = pid => {
    const o = {};
    for (const k of Object.keys(NULL_FX)) o[k] = (...args) => events.push([k, pid, args]);
    o.local = p => (p ? mk(p.id) : NULL_FX);
    return o;
  };
  return mk(null);
}

function createRoom(code, opts = {}) {
  const room = {
    code, world: createWorld(), clients: new Map(), hostId: null, events: [], nextPlayerId: 1,
    startWave: opts.startWave || 0, tick: 0, interval: null, createdAt: Date.now(),
  };
  room.fx = makeRecorder(room.events);
  room.interval = setInterval(() => tickRoom(room), 1000 / TICK_RATE);
  rooms.set(code, room);
  console.log(`[room ${code}] created`);
  return room;
}
function destroyRoom(room) {
  clearInterval(room.interval);
  rooms.delete(room.code);
  console.log(`[room ${room.code}] destroyed`);
}
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const ws of room.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
}
function lobbyMsg(room) {
  return { t: 'lobby', code: room.code, hostId: room.hostId, players: room.world.players.map(p => ({ id: p.id, name: p.name, color: p.color })) };
}
function tickRoom(room) {
  const w = room.world;
  if (w.scene === 'play') update(w, 1 / TICK_RATE, room.fx);
  room.tick++;
  if (w.scene === 'lobby') return; // 大廳不需要快照
  const msg = { t: 'snap', tick: room.tick, s: snapshotWorld(w) };
  if (room.events.length) { msg.ev = room.events.splice(0); }
  broadcast(room, msg);
}

// ---------- 連線 ----------
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null, player = null;
  const send = m => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
  // startRun 會重建玩家物件，所以永遠用 id 查目前的那一個
  const current = () => room?.world.players.find(p => p.id === player.id);

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (typeof m !== 'object' || !m) return;

    if (m.t === 'join') {
      if (room) return;
      const code = m.code ? String(m.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) : '';
      let r = code ? rooms.get(code) : null;
      if (code && !r) { send({ t: 'error', msg: `找不到房間 ${code}` }); return; }
      if (!r) r = createRoom(makeRoomCode(), { startWave: m.boss ? 4 : 0 });
      if (r.clients.size >= MAX_PLAYERS) { send({ t: 'error', msg: '房間已滿（最多 4 人）' }); return; }
      if (r.world.scene !== 'lobby' && r.world.scene !== 'menu') { send({ t: 'error', msg: '這個房間已經開始遊戲' }); return; }
      room = r;
      const id = room.nextPlayerId++;
      player = addPlayer(room.world, { id, name: sanitizeName(m.name), local: false });
      room.world.scene = 'lobby';
      room.clients.set(ws, player);
      if (room.hostId === null) room.hostId = id;
      send({ t: 'welcome', id, code: room.code });
      broadcast(room, lobbyMsg(room));
      console.log(`[room ${room.code}] ${player.name}#${id} joined (${room.clients.size}/${MAX_PLAYERS})`);
      return;
    }
    if (!room || !player) return;

    switch (m.t) {
      case 'input': {
        const clampN = (v, lim) => Math.max(-lim, Math.min(lim, Number(v) || 0));
        const cur = current();
        if (cur) cur.input = { ix: clampN(m.ix, 1), iy: clampN(m.iy, 1), angle: clampN(m.angle, Math.PI), fire: !!m.fire, dash: !!m.dash };
        break;
      }
      case 'start':
        if (player.id !== room.hostId) return;
        if (room.world.scene === 'lobby' || room.world.scene === 'gameover') {
          startRun(room.world, { startWave: room.startWave });
          room.events.length = 0;
          broadcast(room, { t: 'started' });
          console.log(`[room ${room.code}] run started with ${room.world.players.length} players`);
        }
        break;
      case 'upgrade':
        chooseUpgrade(room.world, player.id, Number(m.idx) | 0, room.fx);
        break;
      case 'leave':
        ws.close();
        break;
    }
  });

  ws.on('close', () => {
    if (!room || !player) return;
    room.clients.delete(ws);
    const w = room.world;
    const idx = w.players.findIndex(p => p.id === player.id);
    if (idx >= 0) w.players.splice(idx, 1);
    console.log(`[room ${room.code}] ${player.name}#${player.id} left`);
    if (room.clients.size === 0) { destroyRoom(room); return; }
    if (room.hostId === player.id) room.hostId = room.clients.values().next().value.id;
    if (w.scene === 'play' && w.players.every(p => p.dead)) w.scene = 'gameover';
    broadcast(room, lobbyMsg(room));
  });
});

// WebSocket 保活：雲端反向代理通常會切掉 30 到 60 秒沒流量的連線，每 25 秒 ping 一次；
// 兩次沒回 pong 視為斷線
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

// 空房清理保險（正常情況 close 事件就會清）
setInterval(() => { for (const r of rooms.values()) if (r.clients.size === 0 && Date.now() - r.createdAt > 60000) destroyRoom(r); }, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`星塵突圍 server → http://localhost:${PORT}  (ws on same port, tick ${TICK_RATE}Hz, node ${process.version})`);
});
