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
import { createWorld, addPlayer, joinMidGame, startRun, update, chooseUpgrade, dropPendingUpgrade, queueInput, continueEndless, finishRun, NULL_FX } from '../public/js/game.js';
import { snapshotWorld } from '../shared/snapshot.js';
import { OFFLINE_GRACE, TICK_RATE, MAX_PLAYERS, MIN_RUN_SCORE, sanitizeName, dustFor, PERKS, shipUnlocked, SHIPS, WEAPONS, weaponUnlocked, SKINS, skinUnlocked, SKILLS, skillUnlocked, BOSS_RUSH_REWARD, weaponAllowed, defaultWeaponFor } from '../shared/constants.js';
import { dayKey, dailyChallenge } from '../shared/daily.js';
import { runSummary, applyRun, weekKey, dailyQuests, weeklyQuests, ACHIEVEMENTS } from '../shared/meta.js';
import { ARENAS } from '../shared/constants.js';
import { openDb } from './db.js';
import { computeStats } from './stats.js';

const db = await openDb();
process.on('uncaughtException', e => console.error('[uncaught]', e));
process.on('unhandledRejection', e => console.error('[unhandled]', e));
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
// 每個 IP 的 POST 速率限制（token bucket：每 10 秒 RATE_LIMIT 次）
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 40), buckets = new Map();
function allowPost(ip) { const now = Date.now(); let b = buckets.get(ip); if (!b || now - b.t > 10000) { b = { t: now, n: 0 }; buckets.set(ip, b); } return ++b.n <= RATE_LIMIT; }
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 30000) buckets.delete(k); }, 60000).unref();
// 同一帳號的 meta 讀改寫要排隊（否則兩個同時到的請求會互相蓋掉、重複發星塵）
const locks = new Map();
function withAccountLock(id, fn) { const prev = locks.get(id) || Promise.resolve(); const next = prev.catch(() => {}).then(fn); locks.set(id, next); next.finally(() => { if (locks.get(id) === next) locks.delete(id); }); return next; }
const META_MIN_GAP = Number(process.env.META_MIN_GAP_MS ?? 8000), metaLast = new Map();
/** 帳號憑證：POST 放在 body（不進 log）；GET query 仍相容舊客戶端 */
async function credsOf(req, url) { if (req.method === 'POST') { const b = await readBody(req); return { id: String(b.id || ''), secret: String(b.secret || '') }; } return { id: url.searchParams.get('id') || '', secret: url.searchParams.get('secret') || '' }; }
const taipeiHour = () => new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
const ADMIN_KEY = process.env.ADMIN_KEY || '';
/** 伺服器自己記的事件（房間、合作局） */
function logEvent(name, props = {}, acct = null) { db.addEvents([{ at: Date.now(), acct, sid: 'server', name, props }]).catch(() => {}); }
const EVENT_NAMES = new Set(['session', 'run_start', 'run_end', 'upgrade', 'daily_start', 'perk_buy', 'quest', 'achievement', 'quickmatch']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = Number(process.env.PORT) || 8765;
const BUILD_ID = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 10) || String(Date.now());

// ---------- 靜態檔 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json',
};
function resolveFile(urlPath) {
  let base = PUBLIC, rel = urlPath;
  if (urlPath === '/shared' || urlPath.startsWith('/shared/')) { base = SHARED; rel = urlPath.slice('/shared'.length); }
  if (rel === '' || rel === '/') rel = '/index.html';
  const abs = path.normalize(path.join(base, rel));
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}
// ---------- REST API：帳號與排行榜 ----------
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 16384) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
const MODES = new Set(['solo', 'coop', 'daily']);
async function handleApi(req, res, url) {
  try {
    if (req.method === 'POST' && !allowPost(req.socket.remoteAddress || '?')) return json(res, 429, { error: 'too many requests' });
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const b = await readBody(req);
      return json(res, 200, await db.register(sanitizeName(b.name)));
    }
    if (req.method === 'POST' && url.pathname === '/api/rename') {
      const b = await readBody(req);
      const me = await db.auth(String(b.id || ''), String(b.secret || ''));
      if (!me) return json(res, 401, { error: 'unauthorized' });
      await db.rename(me.id, sanitizeName(b.name));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/runs') {
      // 單人 / 每日成績由客戶端回報（單機模擬在瀏覽器）；合作成績由伺服器自己記錄，不走這裡。
      // 不論分數高低都發星塵；只有達到 MIN_RUN_SCORE 的局才上榜。每日挑戰一天一次。
      const b = await readBody(req);
      const me = await db.auth(String(b.id || ''), String(b.secret || ''));
      if (!me) return json(res, 401, { error: 'unauthorized' });
      const score = Math.max(0, Math.min(10_000_000, Number(b.score) | 0)), wave = Math.max(0, Math.min(999, Number(b.wave) | 0));
      const mode = b.mode === 'daily' ? 'daily' : 'solo';
      const day = mode === 'daily' ? dayKey() : null;
      if (mode === 'daily') {
        if (b.day && b.day !== day) return json(res, 400, { error: 'daily expired' });
        if (await db.dailyRun(me.id, day)) return json(res, 400, { error: 'daily already played' });
      }
      const prof = await db.profile(me.id);
      if (score > 600 * (wave + 2) ** 2) return json(res, 400, { error: 'implausible' });
      const bonus = Math.max(0, Math.min(150, Number(b.dustBonus) | 0));   // 星塵碎片（事件撿到的），上限 150
      const dust = Math.round(dustFor(score, wave, prof?.unlocks) * (b.boss ? BOSS_RUSH_REWARD : 1)) + bonus;
      await db.grantDust(me.id, dust);
      let rank = null, id = null;
      if (score >= MIN_RUN_SCORE || mode === 'daily') { const r = await db.addRun({ mode, score, wave, party: [{ id: me.id, name: me.name }], day }); rank = r.rank; id = r.id; }
      return json(res, 200, { id, rank, dust, bonus, total: (prof?.dust || 0) + dust, mode, day });
    }
    if (req.method === 'POST' && url.pathname === '/api/perks/buy') {
      const b = await readBody(req);
      const me = await db.auth(String(b.id || ''), String(b.secret || ''));
      if (!me) return json(res, 401, { error: 'unauthorized' });
      const r = await db.buyPerk(me.id, String(b.perk || ''));
      if (r.ok) logEvent('perk_buy', { perk: String(b.perk) }, me.id);
      return json(res, r.error ? 400 : 200, r);
    }
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/daily') {
      // 今天的挑戰規則 + 若有帳號則附上是否已挑戰過
      const c = dailyChallenge(dayKey());
      const out = { key: c.key, seed: c.seed, mods: c.mods.map(m => m.id) };
      const cr = await credsOf(req, url);
      const me = cr.id ? await db.auth(cr.id, cr.secret) : null;
      if (me) { const prof = await db.profile(me.id); out.started = prof?.dailyStarted === c.key; out.run = await db.dailyRun(me.id, c.key); }
      return json(res, 200, out);
    }
    if (req.method === 'POST' && url.pathname === '/api/daily/start') {
      // 開始每日挑戰即視為用掉今天的機會（重新整理也不能重來）
      const b = await readBody(req);
      const me = await db.auth(String(b.id || ''), String(b.secret || ''));
      if (!me) return json(res, 401, { error: 'unauthorized' });
      const c = dailyChallenge(dayKey());
      const prof = await db.profile(me.id);
      if (prof?.dailyStarted === c.key || await db.dailyRun(me.id, c.key)) return json(res, 400, { error: 'daily already played' });
      await db.dailyStart(me.id, c.key);
      logEvent('daily_start', { key: c.key }, me.id);
      return json(res, 200, { ok: true, key: c.key, seed: c.seed, mods: c.mods.map(m => m.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/runs/delete') {
      // 玩家可刪除自己的單人成績（合作成績由伺服器記錄，不可刪）
      const b = await readBody(req);
      const me = await db.auth(String(b.id || ''), String(b.secret || ''));
      if (!me) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { ok: await db.deleteOwnRun(Number(b.runId) | 0, me.id) });
    }
    if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
      const mode = MODES.has(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'solo';
      const period = mode === 'daily' ? 'day' : url.searchParams.get('period') === 'week' ? 'week' : 'all';
      const day = mode === 'daily' ? dayKey() : null;
      return json(res, 200, { mode, period, day, rows: await db.top(mode, period, 20, day) });
    }
    if (req.method === 'POST' && url.pathname === '/api/events') {
      // 客戶端批次事件：只收白名單事件名、每筆 props 限 2KB、一次最多 50 筆
      const b = await readBody(req);
      const sid = String(b.sid || '').slice(0, 24);
      const list = (Array.isArray(b.events) ? b.events : []).slice(0, 50)
        .filter(e => e && EVENT_NAMES.has(e.name) && typeof e.props === 'object' && JSON.stringify(e.props).length <= 2048)
        .map(e => ({ at: Date.now(), acct: e.acct ? String(e.acct).slice(0, 32) : null, sid, name: e.name, props: e.props }));
      if (list.length) await db.addEvents(list);
      return json(res, 200, { ok: true, n: list.length });
    }
    if (req.method === 'GET' && url.pathname === '/api/stats') {
      // 管理用：需要 ADMIN_KEY（環境變數）；沒設定時只允許本機
      const key = url.searchParams.get('key') || '';
      const ip = req.socket.remoteAddress || '';
      const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      const ok = ADMIN_KEY ? (key.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_KEY))) : local;
      if (!ok) return json(res, 401, { error: 'unauthorized' });
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
      return json(res, 200, computeStats(await db.events(days)));
    }
    if (req.method === 'GET' && url.pathname === '/api/rooms') {
      // 公開房間列表：在大廳、未滿的房
      const list = [...rooms.values()].filter(r => r.public && r.world.scene === 'lobby' && r.clients.size > 0 && r.clients.size + (r.pendingJoins || 0) < MAX_PLAYERS)
        .map(r => ({ code: r.code, players: r.clients.size, max: MAX_PLAYERS, arena: r.arena, host: r.world.players.find(p => p.id === r.hostId)?.name || '', age: Math.round((Date.now() - r.createdAt) / 1000) }));
      return json(res, 200, { rooms: list });
    }
    if (req.method === 'POST' && url.pathname === '/api/quickmatch') {
      // 快速配對：找一間有人的公開大廳；沒有就開一間公開房讓下一個人配到
      const open = [...rooms.values()].filter(r => r.public && r.world.scene === 'lobby' && (r.clients.size > 0 || r.quick) && r.clients.size + (r.pendingJoins || 0) < MAX_PLAYERS).sort((a, b) => b.clients.size - a.clients.size)[0];
      if (open) { logEvent('quickmatch', { kind: 'join', players: open.clients.size }); return json(res, 200, { code: open.code, created: false }); }
      const r = createRoom(makeRoomCode()); r.public = true; r.quick = true;
      logEvent('quickmatch', { kind: 'create' });
      return json(res, 200, { code: r.code, created: true });
    }
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/meta') {
      const cr = await credsOf(req, url); const me = await db.auth(cr.id, cr.secret);
      if (!me) return json(res, 401, { error: 'unauthorized' });
      const meta = await db.meta(me.id);
      return json(res, 200, { meta, day: dayKey(), week: weekKey(), daily: dailyQuests(dayKey()).map(q => ({ id: q.id, goal: q.goal, dust: q.dust })), weekly: weeklyQuests(weekKey()).map(q => ({ id: q.id, goal: q.goal, dust: q.dust })) });
    }
    if (req.method === 'POST' && url.pathname === '/api/meta/run') {
      // 一局結束：用統計摘要算任務與成就（規則在 shared/meta.js），發星塵
      const b = await readBody(req);
      const me = await db.auth(String(b.id || ''), String(b.secret || ''));
      if (!me) return json(res, 401, { error: 'unauthorized' });
      const run = sanitizeRun(b.run);
      if (!run) return json(res, 400, { error: 'bad run' });
      if (run.coop) return json(res, 400, { error: 'coop runs are recorded by the server' });
      const last = metaLast.get(me.id) || 0;
      if (Date.now() - last < META_MIN_GAP) return json(res, 429, { error: 'too fast' });
      metaLast.set(me.id, Date.now());
      const { r, meta } = await withAccountLock(me.id, async () => { const meta = await db.meta(me.id); const r = applyRun(meta, run, dayKey(), weekKey()); await db.setMeta(me.id, meta); if (r.dust) await db.grantDust(me.id, r.dust); return { r, meta }; });
      for (const id of r.ach) logEvent('achievement', { id }, me.id);
      for (const id of r.quests) logEvent('quest', { id }, me.id);
      const prof = await db.profile(me.id);
      return json(res, 200, { ach: r.ach, quests: r.quests, dust: r.dust, total: prof?.dust || 0, meta });
    }
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/me') {
      const cr = await credsOf(req, url); const me = await db.auth(cr.id, cr.secret);
      if (!me) return json(res, 401, { error: 'unauthorized' });
      const prof = await db.profile(me.id);
      return json(res, 200, { id: me.id, name: me.name, stats: await db.me(me.id), dust: prof?.dust || 0, dustTotal: prof?.dustTotal || 0, unlocks: prof?.unlocks || [] });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    if (e && (e.message === 'bad json' || e.message === 'too large')) return json(res, 400, { error: e.message });
    console.error('[api]', url.pathname, e);
    return json(res, 500, { error: 'server error' });
  }
}

/** 只留下 meta.js 會用到的欄位，數值夾在合理範圍 */
function sanitizeRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const n = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
  const obj = (o, max) => { const out = {}; if (o && typeof o === 'object') for (const [k, v] of Object.entries(o).slice(0, 40)) out[String(k).slice(0, 24)] = n(v, max); return out; };
  const arr = (a, max) => Array.isArray(a) ? a.slice(0, max).map(x => String(x).slice(0, 24)) : [];
  return {
    wave: n(raw.wave, 999), won: !!raw.won, endless: !!raw.endless, coop: !!raw.coop, arena: ARENAS.some(a => a.id === raw.arena) ? raw.arena : 'space', ship: raw.ship ? String(raw.ship).slice(0, 16) : null, weapon: raw.weapon ? String(raw.weapon).slice(0, 16) : null, hour: new Date(Date.now() + 8 * 3600 * 1000).getUTCHours(), players: n(raw.players, 4),
    kills: obj(raw.kills, 100000), elites: n(raw.elites, 10000), bosses: n(raw.bosses, 1000), blinks: n(raw.blinks, 100000), dashes: n(raw.dashes, 100000), pickups: n(raw.pickups, 100000), grazes: n(raw.grazes, 100000), maxCombo: n(raw.maxCombo, 100000), swings: n(raw.swings, 1e6), parries: n(raw.parries, 1e6),
    bestNoFire: n(raw.bestNoFire, 1e5), bestNoHit: n(raw.bestNoHit, 1e5), bestStill: n(raw.bestStill, 1e5), upgrades: n(raw.upgrades, 1000), crateHp: Number(raw.crateHp) === 1 ? 1 : Number(raw.crateHp) >= 0 ? n(raw.crateHp, 1) : -1, doomSurvived: !!raw.doomSurvived, kamiKills: n(raw.kamiKills, 1e5), sniperKills: n(raw.sniperKills, 1e5),
    weaponKills: obj(raw.weaponKills, 100000), evolved: raw.evolved ? String(raw.evolved).slice(0, 16) : null, hoard: n(raw.hoard, 1000), events: arr(raw.events, 30), bossesSeen: arr(raw.bossesSeen, 8), doubleBoss: !!raw.doubleBoss, dmgDealt: n(raw.dmgDealt, 1e9), dmgTaken: n(raw.dmgTaken, 1e9), timeAlive: n(raw.timeAlive, 1e6),
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) { handleApi(req, res, url); return; }
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.clients.size, 0), db: db.kind })); return; }
  if (url.pathname === '/sw.js') {
    // Service worker：注入版本號（每次部署不同），讓舊快取自動失效
    fs.readFile(path.join(PUBLIC, 'sw.js'), 'utf8', (err, src) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/', ...SEC }); res.end('self.__SW_VERSION__ = ' + JSON.stringify(BUILD_ID) + ';\n' + src); });
    return;
  }
  let decoded; try { decoded = decodeURIComponent(url.pathname); } catch { res.writeHead(400, SEC); res.end('Bad Request'); return; }
  const file = resolveFile(decoded);
  if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      // 音樂等大檔支援 Range（Safari 沒有 206 不會播）
      let start = range[1] ? Number(range[1]) : 0, end = range[2] ? Number(range[2]) : st.size - 1;
      if (!range[1] && range[2]) { start = Math.max(0, st.size - Number(range[2])); end = st.size - 1; }
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...SEC, 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': type.startsWith('audio') ? 'public, max-age=86400' : 'no-cache' });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...SEC, 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': type.startsWith('audio') ? 'public, max-age=86400' : 'no-cache' });
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
  const room = { code, world: createWorld(), clients: new Map(), hostId: null, events: [], nextPlayerId: 1, tick: 0, interval: null, createdAt: Date.now(), departed: [], recorded: false, arena: 'space', public: false };
  room.world.scene = 'lobby';
  room.fx = makeRecorder(room.events);
  room.interval = setInterval(() => tickRoom(room), 1000 / TICK_RATE);
  rooms.set(code, room);
  logEvent('room', { kind: 'create' });
  console.log(`[room ${code}] created`);
  return room;
}
function destroyRoom(room) { clearInterval(room.interval); rooms.delete(room.code); console.log(`[room ${room.code}] destroyed`); }
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  for (const ws of room.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
}
function lobbyMsg(room) {
  return { t: 'lobby', code: room.code, hostId: room.hostId, scene: room.world.scene, arena: room.arena, public: room.public, players: room.world.players.filter(p => !p.offline).map(p => ({ id: p.id, name: p.name, color: p.color, ship: p.ship })) };
}
function inProgress(room) { const s = room.world.scene; return s === 'play' || s === 'upgrade' || s === 'pause' || s === 'victory'; }
async function recordCoopRun(room) {
  const w = room.world;
  if (room.recorded) return;
  room.recorded = true;
  for (const p of w.players) logEvent('run_end', { mode: 'coop', ship: p.ship, wave: w.wave, score: w.score, reason: w.won ? 'victory' : 'dead', dur: Math.round(w.time), kills: p.kills, ups: Object.keys(p.upgrades), syn: Object.keys(p.syn), players: w.players.length + room.departed.length }, p.acctId || null);
  const metaBy = {};
  for (const p of w.players) if (p.acctId) {
    try {
      const out = await withAccountLock(p.acctId, async () => { const meta = await db.meta(p.acctId); const r = applyRun(meta, runSummary(w, { coop: true, ship: p.ship, weapon: p.weapon, hour: taipeiHour() }), dayKey(), weekKey()); await db.setMeta(p.acctId, meta); if (r.dust) await db.grantDust(p.acctId, r.dust); return r; });
      metaBy[p.acctId] = { ach: out.ach, quests: out.quests, dust: out.dust };
      for (const id of out.ach) logEvent('achievement', { id }, p.acctId);
      for (const id of out.quests) logEvent('quest', { id }, p.acctId);
    } catch (e) { console.error('coop meta failed', e.message); }
  }
  if (w.score < MIN_RUN_SCORE) { broadcast(room, { t: 'result', rank: null, score: w.score, wave: w.wave, dustBy: {}, metaBy }); return; }
  // 隊伍名單：仍在場的玩家 + 中途離隊的玩家（離隊者的擊殺數也計入）
  const party = [...w.players.map(p => ({ id: p.acctId || null, name: p.name, kills: p.kills })), ...room.departed];
  try {
    const r = await db.addRun({ mode: 'coop', score: w.score, wave: w.wave, party });
    const dustBy = {};
    for (const m of party) if (m.id) { const prof = await db.profile(m.id); const d = Math.round(dustFor(w.score, w.wave, prof?.unlocks) * (w.mods && w.mods.bossRush ? BOSS_RUSH_REWARD : 1)); await db.grantDust(m.id, d); dustBy[m.id] = d; }
    broadcast(room, { t: 'result', rank: r.rank, score: w.score, wave: w.wave, dustBy, metaBy });
    console.log(`[room ${room.code}] coop run recorded: score ${w.score} wave ${w.wave} rank #${r.rank}`);
  } catch (e) { console.error('record run failed', e.message); }
}
function tickRoom(room) {
  try { tickRoomInner(room); }
  catch (e) { console.error(`[room ${room.code}] tick failed`, e); broadcast(room, { t: 'error', msg: '房間發生錯誤，請重新建立房間' }); destroyRoom(room); }
}
function tickRoomInner(room) {
  const w = room.world;
  // 離線玩家超過寬限就移除（不論場景，用牆鐘；遊戲中的 world.time 在升級 / 暫停時不會走）
  for (let i = w.players.length - 1; i >= 0; i--) { const p = w.players[i]; if (p.offline && p.offlineAtMs && Date.now() - p.offlineAtMs > OFFLINE_GRACE * 1000) { w.players.splice(i, 1); dropPendingUpgrade(w, p.id); } }
  if (w.scene === 'play') update(w, 1 / TICK_RATE, room.fx);
  if (w.scene === 'gameover') recordCoopRun(room);
  room.tick++;
  if (w.scene === 'lobby') return;
  const msg = { t: 'snap', tick: room.tick, s: snapshotWorld(w) };
  if (w.scene !== 'gameover' && w.scene !== 'victory' && room.tick % 30 !== 0) delete msg.s.stats;   // 統計只在結算與每秒送一次
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

      if (r.clients.size + (r.pendingJoins || 0) >= MAX_PLAYERS) { send({ t: 'error', msg: '房間已滿（最多 4 人）' }); return; }
      room = r; r.pendingJoins = (r.pendingJoins || 0) + 1;
      const wantShip = SHIPS.some(s => s.id === m.ship) ? m.ship : 'falcon';
      const wantWeapon = WEAPONS.some(w => w.id === m.weapon) ? m.weapon : 'blaster';
      const wantSkin = SKINS.some(s => s.id === m.skin) ? m.skin : 'classic';
      const wantSkill = SKILLS.some(s => s.id === m.skill) ? m.skill : 'swarm';
      // 先驗證帳號（取得永久強化與已解鎖機體），再把玩家放進世界，這樣中途加入也會拿到正確的機體
      (async () => { try {
        let acct = null;
        if (m.acct && m.acct.id && m.acct.secret) { try { acct = await db.auth(String(m.acct.id), String(m.acct.secret)); } catch {} }
        if (ws.readyState !== ws.OPEN || !rooms.has(room.code)) return;
        const unlocks = acct?.unlocks || [];
        const ship = shipUnlocked(wantShip, unlocks) ? wantShip : 'falcon';
        let weapon = weaponUnlocked(wantWeapon, unlocks) ? wantWeapon : 'blaster';
        if (!weaponAllowed(ship, weapon)) weapon = defaultWeaponFor(ship);
        const skin = skinUnlocked(wantSkin, unlocks) ? wantSkin : 'classic';
        const skill = skillUnlocked(wantSkill, unlocks) ? wantSkill : 'swarm';
        const id = room.nextPlayerId++;
        const token = crypto.randomBytes(12).toString('base64url');
        const opts = { id, name, token, acctId: acct?.id || null, perks: unlocks, ship, weapon, skin, skill };
        player = inProgress(room) ? joinMidGame(room.world, opts) : addPlayer(room.world, opts);
        room.clients.set(ws, player);
        if (room.hostId === null) room.hostId = id;
        send({ t: 'welcome', id, code: room.code, token, inProgress: inProgress(room), ship });
        broadcast(room, lobbyMsg(room));
        if (inProgress(room)) room.fx.text(room.world.W / 2, room.world.H / 2 - 120, `${name} 加入戰鬥`, player.color, 24, 2);
        if (room.clients.size > 1) logEvent('room', { kind: inProgress(room) ? 'midjoin' : 'join', players: room.clients.size }, acct?.id || null);
        console.log(`[room ${room.code}] ${name}#${id} joined (${room.clients.size}/${MAX_PLAYERS})${inProgress(room) ? ' mid-game' : ''} ship=${ship}`);
      } finally { r.pendingJoins = Math.max(0, (r.pendingJoins || 1) - 1); } })();
      return;
    }
    if (!room || !player) return;

    switch (m.t) {
      case 'input': {
        const clampN = (v, lim) => Math.max(-lim, Math.min(lim, Number(v) || 0));
        const cur = current();
        if (cur) queueInput(cur, Number(m.seq) | 0, { ix: clampN(m.ix, 1), iy: clampN(m.iy, 1), angle: clampN(m.angle, Math.PI), fire: !!m.fire, dash: !!m.dash, blink: !!m.blink, skill: !!m.skill });
        break;
      }
      case 'start':
        if (player.id !== room.hostId) return;
        if (room.world.scene === 'lobby' || room.world.scene === 'gameover') {
          startRun(room.world, { bossRush: !!m.boss, arena: room.arena });
          room.events.length = 0; room.departed = []; room.recorded = false;
          for (const p of room.world.players) logEvent('run_start', { mode: 'coop', ship: p.ship, wave0: m.boss ? 4 : 0, players: room.world.players.length }, p.acctId || null);
          broadcast(room, { t: 'started' });
          console.log(`[room ${room.code}] run started with ${room.world.players.length} players${m.boss ? ' (boss rush)' : ''}`);
        }
        break;
      case 'arena':
        if (player.id === room.hostId && ARENAS.some(a => a.id === m.id) && !inProgress(room)) { room.arena = m.id; broadcast(room, lobbyMsg(room)); }
        break;
      case 'public':
        if (player.id === room.hostId) { room.public = !!m.on; broadcast(room, lobbyMsg(room)); }
        break;
      case 'endless':
        if (player.id === room.hostId && continueEndless(room.world)) console.log(`[room ${room.code}] endless mode`);
        break;
      case 'finish':
        if (player.id === room.hostId) finishRun(room.world);
        break;
      case 'upgrade':
        chooseUpgrade(room.world, player.id, Number(m.idx) | 0, room.fx);
        break;
      case 'leave': {
        // 主動離隊：立刻移出戰場（不保留重連），擊殺數記到隊伍名單；若沒人能戰鬥則整局結束並結算
        const w = room.world, cur = current();
        if (cur && inProgress(room)) {
          room.departed.push({ id: cur.acctId || null, name: cur.name, kills: cur.kills, left: true });
          logEvent('run_end', { mode: 'coop', ship: cur.ship, wave: w.wave, score: w.score, reason: 'left', dur: Math.round(w.time), kills: cur.kills, ups: Object.keys(cur.upgrades), syn: Object.keys(cur.syn) }, cur.acctId || null);
          dropPendingUpgrade(w, cur.id);
          w.players.splice(w.players.indexOf(cur), 1);
          room.fx.text(w.W / 2, w.H / 2 - 120, `${cur.name} 離開了隊伍`, cur.color, 22, 2);
          if (!w.players.some(p => !p.dead && !p.downed && !p.offline)) { w.scene = 'gameover'; recordCoopRun(room); }
          console.log(`[room ${room.code}] ${cur.name}#${cur.id} left the team`);
        }
        ws.close();
        break;
      }
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
        cur.offline = true; cur.offlineAt = w.time; cur.offlineAtMs = Date.now(); cur.inputQueue.length = 0;
        dropPendingUpgrade(w, cur.id);
        if (w.scene === 'play' && !w.players.some(p => !p.dead && !p.downed && !p.offline)) { w.scene = 'gameover'; recordCoopRun(room); }
      } else {
        w.players.splice(w.players.indexOf(cur), 1);
      }
    }
    console.log(`[room ${room.code}] ${player.name}#${player.id} disconnected`);
    if (room.clients.size === 0) { if (room.quick && Date.now() - room.createdAt < 60000) { broadcast(room, lobbyMsg(room)); return; } destroyRoom(room); return; }
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
