// 資料層：玩家帳號、遊玩紀錄、星塵與永久強化、每日挑戰。
// 有 DATABASE_URL → PostgreSQL（Railway 加 Postgres 外掛會自動注入）；
// 沒有 → 本機 JSON 檔（data/store.json），方便開發與尚未加資料庫時先運作。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MIN_RUN_SCORE, PERKS, SHIPS, WEAPONS, SKINS, SKILLS, perkLevels } from '../shared/constants.js';
import { weekStartMs } from '../shared/meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'store.json');
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const WEEK_MS = 7 * 24 * 3600 * 1000;

/** 購買永久強化的共用規則：回傳 {ok, cost} 或 {error} */
function priceOf(unlocks, perkId) {
  if (perkId.startsWith('skin:')) {
    const k = SKINS.find(x => x.id === perkId.slice(5));
    if (!k || !k.cost) return { error: 'unknown perk' };
    if ((unlocks || []).includes(perkId)) return { error: 'max level' };
    return { ok: true, cost: k.cost };
  }
  if (perkId.startsWith('skill:')) {
    const k = SKILLS.find(x => x.id === perkId.slice(6));
    if (!k || !k.cost) return { error: 'unknown perk' };
    if ((unlocks || []).includes(perkId)) return { error: 'max level' };
    return { ok: true, cost: k.cost };
  }
  if (perkId.startsWith('weapon:')) {
    const w = WEAPONS.find(x => x.id === perkId.slice(7));
    if (!w || !w.cost) return { error: 'unknown perk' };
    if ((unlocks || []).includes(perkId)) return { error: 'max level' };
    return { ok: true, cost: w.cost };
  }
  if (perkId.startsWith('ship:')) {
    const s = SHIPS.find(x => x.id === perkId.slice(5));
    if (!s || !s.cost) return { error: 'unknown perk' };
    if ((unlocks || []).includes(perkId)) return { error: 'max level' };
    return { ok: true, cost: s.cost };
  }
  const k = PERKS.find(p => p.id === perkId);
  if (!k) return { error: 'unknown perk' };
  const lv = perkLevels(unlocks)[perkId] || 0;
  if (lv >= k.max) return { error: 'max level' };
  return { ok: true, cost: k.cost[lv] };
}

// ---------- PostgreSQL ----------
async function createPg(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false }, max: 5 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(), last_seen TIMESTAMPTZ DEFAULT now()
    );
    ALTER TABLE players ADD COLUMN IF NOT EXISTS dust INT NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS dust_total INT NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS unlocks TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE players ADD COLUMN IF NOT EXISTS daily_started TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';
    CREATE TABLE IF NOT EXISTS runs (
      id SERIAL PRIMARY KEY, mode TEXT NOT NULL, score INT NOT NULL, wave INT NOT NULL,
      party JSONB NOT NULL, player_ids TEXT[] NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
    );
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS day TEXT;
    CREATE INDEX IF NOT EXISTS runs_mode_score ON runs (mode, score DESC);
    CREATE INDEX IF NOT EXISTS runs_created ON runs (created_at);
    CREATE INDEX IF NOT EXISTS runs_day ON runs (mode, day);
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), acct TEXT, sid TEXT, name TEXT NOT NULL, props JSONB NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS events_at ON events (at);
  `);
  const since = (period, day) => period === 'week' ? `AND created_at >= to_timestamp(${Math.floor(weekStartMs() / 1000)})` : period === 'day' ? `AND day = '${day.replace(/[^0-9-]/g, '')}'` : '';
  const rankOf = async (mode, score, day) => (await pool.query(`SELECT COUNT(*)::int + 1 AS rank FROM runs WHERE mode=$1 AND score > $2 ${mode === 'daily' && day ? `AND day='${day.replace(/[^0-9-]/g, '')}'` : ''}`, [mode, score])).rows[0].rank;
  return {
    kind: 'postgres',
    async register(name) {
      const id = crypto.randomBytes(8).toString('base64url'), secret = crypto.randomBytes(24).toString('base64url');
      await pool.query('INSERT INTO players (id, secret_hash, name) VALUES ($1,$2,$3)', [id, hash(secret), name]);
      return { id, secret, name };
    },
    async auth(id, secret) {
      const r = await pool.query('SELECT id, name, dust, unlocks, daily_started FROM players WHERE id=$1 AND secret_hash=$2', [id, hash(secret)]);
      if (!r.rows[0]) return null;
      pool.query('UPDATE players SET last_seen=now() WHERE id=$1', [id]).catch(() => {});
      return r.rows[0];
    },
    async rename(id, name) { await pool.query('UPDATE players SET name=$2 WHERE id=$1', [id, name]); },
    async addRun({ mode, score, wave, party, day = null }) {
      const ids = party.map(p => p.id).filter(Boolean);
      const r = await pool.query('INSERT INTO runs (mode, score, wave, party, player_ids, day) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [mode, score, wave, JSON.stringify(party), ids, day]);
      return { id: r.rows[0].id, rank: await rankOf(mode, score, day) };
    },
    async deleteOwnRun(runId, playerId) {
      const r = await pool.query('DELETE FROM runs WHERE id=$1 AND mode=$2 AND $3 = ANY(player_ids)', [runId, 'solo', playerId]);
      return r.rowCount > 0;
    },
    async top(mode, period, limit = 20, day = null) {
      const r = await pool.query(`SELECT id, score, wave, party, created_at FROM runs WHERE mode=$1 AND score >= ${MIN_RUN_SCORE} ${since(period, day || '')} ORDER BY score DESC, id ASC LIMIT $2`, [mode, limit]);
      return r.rows.map(row => ({ id: row.id, score: row.score, wave: row.wave, party: row.party, at: row.created_at }));
    },
    async me(id) {
      const best = await pool.query(`SELECT mode, MAX(score) AS best, COUNT(*)::int AS runs, MAX(wave) AS best_wave FROM runs WHERE $1 = ANY(player_ids) AND mode <> 'daily' GROUP BY mode`, [id]);
      const out = {};
      for (const row of best.rows) out[row.mode] = { best: Number(row.best), runs: row.runs, bestWave: Number(row.best_wave), rank: await rankOf(row.mode, Number(row.best)) };
      return out;
    },
    async profile(id) {
      const r = await pool.query('SELECT dust, dust_total, unlocks, daily_started FROM players WHERE id=$1', [id]);
      return r.rows[0] ? { dust: r.rows[0].dust, dustTotal: r.rows[0].dust_total, unlocks: r.rows[0].unlocks, dailyStarted: r.rows[0].daily_started } : null;
    },
    async grantDust(id, amount) {
      if (amount <= 0) return;
      await pool.query('UPDATE players SET dust = dust + $2, dust_total = dust_total + $2 WHERE id=$1', [id, amount]);
    },
    async buyPerk(id, perkId) {
      const p = await this.profile(id);
      if (!p) return { error: 'unauthorized' };
      const q = priceOf(p.unlocks, perkId);
      if (q.error) return q;
      if (p.dust < q.cost) return { error: 'not enough dust' };
      const r = await pool.query('UPDATE players SET dust = dust - $2, unlocks = array_append(unlocks, $3) WHERE id=$1 AND dust >= $2 RETURNING dust, unlocks', [id, q.cost, perkId]);
      if (!r.rows[0]) return { error: 'not enough dust' };
      return { ok: true, dust: r.rows[0].dust, unlocks: r.rows[0].unlocks };
    },
    async dailyStart(id, day) { await pool.query('UPDATE players SET daily_started=$2 WHERE id=$1', [id, day]); },
    async meta(id) { const r = await pool.query('SELECT meta FROM players WHERE id=$1', [id]); return r.rows[0]?.meta || {}; },
    async setMeta(id, meta) { await pool.query('UPDATE players SET meta=$2 WHERE id=$1', [id, JSON.stringify(meta)]); },
    async dailyRun(id, day) {
      const r = await pool.query(`SELECT id, score, wave FROM runs WHERE mode='daily' AND day=$2 AND $1 = ANY(player_ids) LIMIT 1`, [id, day]);
      if (!r.rows[0]) return null;
      return { ...r.rows[0], rank: await rankOf('daily', r.rows[0].score, day) };
    },
    async addEvents(list) {
      if (!list.length) return;
      const vals = [], params = [];
      list.forEach((e, i) => { vals.push(`($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`); params.push(new Date(e.at), e.acct, e.sid, e.name, JSON.stringify(e.props)); });
      await pool.query(`INSERT INTO events (at, acct, sid, name, props) VALUES ${vals.join(',')}`, params);
    },
    async events(sinceDays = 30, limit = 100000) {
      const r = await pool.query('SELECT at, acct, sid, name, props FROM events WHERE at > now() - ($1 || \' days\')::interval ORDER BY at DESC LIMIT $2', [String(sinceDays), limit]);
      return r.rows.map(x => ({ at: new Date(x.at).getTime(), acct: x.acct, sid: x.sid, name: x.name, props: x.props || {} }));
    },
  };
}

// ---------- JSON 檔 ----------
function createFileStore() {
  let data = { players: {}, runs: [], nextRun: 1, events: [] };
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(data)); } catch (e) { console.error('store save failed', e.message); } }, 200); };
  const inPeriod = (r, period, day) => period === 'week' ? new Date(r.at).getTime() >= weekStartMs() : period === 'day' ? r.day === day : true;
  const rankOf = (mode, score, day) => data.runs.filter(r => r.mode === mode && r.score > score && (mode !== 'daily' || !day || r.day === day)).length + 1;
  const pl = id => { const p = data.players[id]; if (p) { p.dust ??= 0; p.dustTotal ??= 0; p.unlocks ??= []; } return p; };
  return {
    kind: 'file',
    async register(name) {
      const id = crypto.randomBytes(8).toString('base64url'), secret = crypto.randomBytes(24).toString('base64url');
      data.players[id] = { id, secretHash: hash(secret), name, createdAt: new Date().toISOString(), dust: 0, dustTotal: 0, unlocks: [], dailyStarted: null };
      save(); return { id, secret, name };
    },
    async auth(id, secret) { const p = pl(id); return p && p.secretHash === hash(secret) ? { id, name: p.name, dust: p.dust, unlocks: p.unlocks, daily_started: p.dailyStarted } : null; },
    async rename(id, name) { if (data.players[id]) { data.players[id].name = name; save(); } },
    async addRun({ mode, score, wave, party, day = null }) {
      const run = { id: data.nextRun++, mode, score, wave, party, ids: party.map(p => p.id).filter(Boolean), at: new Date().toISOString(), day };
      data.runs.push(run); if (data.runs.length > 5000) data.runs.splice(0, data.runs.length - 5000);
      save(); return { id: run.id, rank: rankOf(mode, score, day) };
    },
    async deleteOwnRun(runId, playerId) {
      const i = data.runs.findIndex(r => r.id === runId && r.mode === 'solo' && r.ids.includes(playerId));
      if (i < 0) return false;
      data.runs.splice(i, 1); save(); return true;
    },
    async top(mode, period, limit = 20, day = null) {
      return data.runs.filter(r => r.mode === mode && r.score >= MIN_RUN_SCORE && inPeriod(r, period, day)).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limit).map(r => ({ id: r.id, score: r.score, wave: r.wave, party: r.party, at: r.at }));
    },
    async me(id) {
      const out = {};
      for (const mode of ['solo', 'coop']) {
        const mine = data.runs.filter(r => r.mode === mode && r.ids.includes(id));
        if (!mine.length) continue;
        const best = Math.max(...mine.map(r => r.score));
        out[mode] = { best, runs: mine.length, bestWave: Math.max(...mine.map(r => r.wave)), rank: rankOf(mode, best) };
      }
      return out;
    },
    async profile(id) { const p = pl(id); return p ? { dust: p.dust, dustTotal: p.dustTotal, unlocks: p.unlocks, dailyStarted: p.dailyStarted || null } : null; },
    async grantDust(id, amount) { const p = pl(id); if (p && amount > 0) { p.dust += amount; p.dustTotal += amount; save(); } },
    async buyPerk(id, perkId) {
      const p = pl(id);
      if (!p) return { error: 'unauthorized' };
      const q = priceOf(p.unlocks, perkId);
      if (q.error) return q;
      if (p.dust < q.cost) return { error: 'not enough dust' };
      p.dust -= q.cost; p.unlocks.push(perkId); save();
      return { ok: true, dust: p.dust, unlocks: p.unlocks.slice() };
    },
    async dailyStart(id, day) { const p = pl(id); if (p) { p.dailyStarted = day; save(); } },
    async meta(id) { const p = pl(id); return p ? (p.meta ||= {}) : {}; },
    async setMeta(id, meta) { const p = pl(id); if (p) { p.meta = meta; save(); } },
    async dailyRun(id, day) {
      const r = data.runs.find(r => r.mode === 'daily' && r.day === day && r.ids.includes(id));
      return r ? { id: r.id, score: r.score, wave: r.wave, rank: rankOf('daily', r.score, day) } : null;
    },
    async addEvents(list) { data.events ??= []; data.events.push(...list); if (data.events.length > 50000) data.events.splice(0, data.events.length - 50000); save(); },
    async events(sinceDays = 30, limit = 100000) { const since = Date.now() - sinceDays * 24 * 3600 * 1000; return (data.events || []).filter(e => e.at > since).slice(-limit); },
  };
}

export async function openDb() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try { const db = await createPg(url); console.log('[db] PostgreSQL connected'); return db; }
    catch (e) { console.error('[db] PostgreSQL failed, falling back to file store:', e.message); }
  }
  console.log('[db] using JSON file store at', DATA_FILE);
  return createFileStore();
}
