// 遊戲伺服器：靜態檔 + WebSocket 房間。
// 每個房間持有一個權威 world，以 TICK_RATE 跑 game.js 的 update()，
// 每 tick 廣播快照與 fx 事件；客戶端只送輸入。
// 支援：中途加入、斷線 15 秒內以 token 重連、房主選擇 Boss 挑戰模式。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createWorld, addPlayer, joinMidGame, startRun, update, chooseUpgrade, dropPendingUpgrade, queueInput, NULL_FX } from '../public/js/game.js';
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
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.clients.size, 0) })); return; }
  const file = resolveFile(decodeURIComponent(url.pathname));
  if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------- 房間 ----------
const rooms = new Map();
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeRoomCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join(''); } while (rooms.has(code));
  return code;
}
function makeRecorder(events) {
  const mk = pid => {
    const o = {};
    for (const k of Object.keys(NULL_FX)) o[k] = (...args) => events.push([k, pid, args]);
    o.local = p => (p ? mk(p.id) : NULL_FX);
    return o;
  };
  return mk(null);
}
function createRoom(code) {
  const room = { code, world: createWorld(), clients: new Map(), hostId: null, events: [], nextPlayerId: 1, tick: 0, interval: null, createdAt: Date.now() };
  room.world.scene = 'lobby';
  room.fx = makeRecorder(room.events);
  room.interval = setInterval(() => tickRoom(room), 1000 / TICK_RATE);
  rooms.set(code, room);
  console.log(`[room ${code}] created`);
  return room;
}
function destroyRoom(room) { clearInterval(room.interval); rooms.delete(room.code); console.log(`[room ${room.code}] destroyed`); }
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const ws of room.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
}
function lobbyMsg(room) {
  return { t: 'lobby', code: room.code, hostId: room.hostId, scene: room.world.scene, players: room.world.players.filter(p => !p.offline).map(p => ({ id: p.id, name: p.name, color: p.color })) };
}
function inProgress(room) { const s = room.world.scene; return s === 'play' || s === 'upgrade' || s === 'pause'; }
function tickRoom(room) {
  const w = room.world;
  if (w.scene === 'play') update(w, 1 / TICK_RATE, room.fx);
  room.tick++;
  if (w.scene === 'lobby') return;
  const msg = { t: 'snap', tick: room.tick, s: snapshotWorld(w) };
  if (room.events.length) msg.ev = room.events.splice(0);
  broadcast(room, msg);
}
function pickHost(room) {
  const first = [...room.clients.values()][0];
  room.hostId = first ? first.id : null;
}

// ---------- 連線 ----------
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null, player = null;
  const send = m => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
  const current = () => room?.world.players.find(p => p.id === player.id);

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (typeof m !== 'object' || !m) return;

    if (m.t === 'join') {
      if (room) return;
      const code = m.code ? String(m.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) : '';
      let r = code ? rooms.get(code) : null;
      if (code && !r) { send({ t: 'error', msg: `找不到房間 ${code}` }); return; }
      if (!r) r = createRoom(makeRoomCode());
      const name = sanitizeName(m.name);

      // 重連：token 對得上斷線中的玩家 → 接回原角色
      const ghost = m.token ? r.world.players.find(p => p.offline && p.token === m.token) : null;
      if (ghost) {
        room = r; player = ghost;
        ghost.offline = false;
        room.clients.set(ws, ghost);
        if (room.hostId === null) room.hostId = ghost.id;
        send({ t: 'welcome', id: ghost.id, code: room.code, token: ghost.token, resumed: true, inProgress: inProgress(room) });
        broadcast(room, lobbyMsg(room));
        room.fx.text(room.world.W / 2, room.world.H / 2 - 120, `${ghost.name} 重新連線`, ghost.color, 22, 1.8);
        console.log(`[room ${room.code}] ${ghost.name}#${ghost.id} reconnected`);
        return;
      }

      if (r.clients.size >= MAX_PLAYERS) { send({ t: 'error', msg: '房間已滿（最多 4 人）' }); return; }
      room = r;
      const id = room.nextPlayerId++;
      const token = crypto.randomBytes(12).toString('base64url');
      player = inProgress(room) ? joinMidGame(room.world, { id, name, token }) : addPlayer(room.world, { id, name, token });
      room.clients.set(ws, player);
      if (room.hostId === null) room.hostId = id;
      send({ t: 'welcome', id, code: room.code, token, inProgress: inProgress(room) });
      broadcast(room, lobbyMsg(room));
      if (inProgress(room)) room.fx.text(room.world.W / 2, room.world.H / 2 - 120, `${name} 加入戰鬥`, player.color, 24, 2);
      console.log(`[room ${room.code}] ${name}#${id} joined (${room.clients.size}/${MAX_PLAYERS})${inProgress(room) ? ' mid-game' : ''}`);
      return;
    }
    if (!room || !player) return;

    switch (m.t) {
      case 'input': {
        const clampN = (v, lim) => Math.max(-lim, Math.min(lim, Number(v) || 0));
        const cur = current();
        if (cur) queueInput(cur, Number(m.seq) | 0, { ix: clampN(m.ix, 1), iy: clampN(m.iy, 1), angle: clampN(m.angle, Math.PI), fire: !!m.fire, dash: !!m.dash });
        break;
      }
      case 'start':
        if (player.id !== room.hostId) return;
        if (room.world.scene === 'lobby' || room.world.scene === 'gameover') {
          startRun(room.world, { startWave: m.boss ? 4 : 0 });
          room.events.length = 0;
          broadcast(room, { t: 'started' });
          console.log(`[room ${room.code}] run started with ${room.world.players.length} players${m.boss ? ' (boss rush)' : ''}`);
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
    const cur = w.players.find(p => p.id === player.id);
    if (cur) {
      if (inProgress(room) && !cur.dead) {
        // 遊戲中斷線：保留角色一段時間等重連
        cur.offline = true; cur.offlineAt = w.time; cur.inputQueue.length = 0;
        dropPendingUpgrade(w, cur.id);
        if (w.scene === 'play' && !w.players.some(p => !p.dead && !p.downed && !p.offline)) w.scene = 'gameover';
      } else {
        w.players.splice(w.players.indexOf(cur), 1);
      }
    }
    console.log(`[room ${room.code}] ${player.name}#${player.id} disconnected`);
    if (room.clients.size === 0) { destroyRoom(room); return; }
    if (room.hostId === player.id) pickHost(room);
    broadcast(room, lobbyMsg(room));
  });
});

// WebSocket 保活：每 25 秒 ping，兩次沒回 pong 視為斷線
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);
// 空房清理保險
setInterval(() => { for (const r of rooms.values()) if (r.clients.size === 0 && Date.now() - r.createdAt > 60000) destroyRoom(r); }, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`星塵突圍 server → http://localhost:${PORT}  (ws on same port, tick ${TICK_RATE}Hz, node ${process.version})`);
});
