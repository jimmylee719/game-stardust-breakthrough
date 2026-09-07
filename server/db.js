// 資料層：玩家帳號與遊玩紀錄。
// 有 DATABASE_URL → PostgreSQL（Railway 加 Postgres 外掛會自動注入）；
// 沒有 → 本機 JSON 檔（data/store.json），方便開發與尚未加資料庫時先運作。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MIN_RUN_SCORE } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'store.json');
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const WEEK_MS = 7 * 24 * 3600 * 1000;

// ---------- PostgreSQL ----------
async function createPg(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false }, max: 5 });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(), last_seen TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS runs (
      id SERIAL PRIMARY KEY, mode TEXT NOT NULL, score INT NOT NULL, wave INT NOT NULL,
      party JSONB NOT NULL, player_ids TEXT[] NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS runs_mode_score ON runs (mode, score DESC);
    CREATE INDEX IF NOT EXISTS runs_created ON runs (created_at);
  `);
  const since = period => (period === 'week' ? `AND created_at > now() - interval '7 days'` : '');
  return {
    kind: 'postgres',
    async register(name) {
      const id = crypto.randomBytes(8).toString('base64url'), secret = crypto.randomBytes(24).toString('base64url');
      await pool.query('INSERT INTO players (id, secret_hash, name) VALUES ($1,$2,$3)', [id, hash(secret), name]);
      return { id, secret, name };
    },
    async auth(id, secret) {
      const r = await pool.query('SELECT id, name FROM players WHERE id=$1 AND secret_hash=$2', [id, hash(secret)]);
      if (!r.rows[0]) return null;
      pool.query('UPDATE players SET last_seen=now() WHERE id=$1', [id]).catch(() => {});
      return r.rows[0];
    },
    async rename(id, name) { await pool.query('UPDATE players SET name=$2 WHERE id=$1', [id, name]); },
    async addRun({ mode, score, wave, party }) {
      const ids = party.map(p => p.id).filter(Boolean);
      const r = await pool.query('INSERT INTO runs (mode, score, wave, party, player_ids) VALUES ($1,$2,$3,$4,$5) RETURNING id', [mode, score, wave, JSON.stringify(party), ids]);
      const rank = await pool.query(`SELECT COUNT(*)::int + 1 AS rank FROM runs WHERE mode=$1 AND score > $2`, [mode, score]);
      return { id: r.rows[0].id, rank: rank.rows[0].rank };
    },
    async deleteOwnRun(runId, playerId) {
      const r = await pool.query('DELETE FROM runs WHERE id=$1 AND mode=$2 AND $3 = ANY(player_ids)', [runId, 'solo', playerId]);
      return r.rowCount > 0;
    },
    async top(mode, period, limit = 20) {
      const r = await pool.query(`SELECT id, score, wave, party, created_at FROM runs WHERE mode=$1 AND score >= ${MIN_RUN_SCORE} ${since(period)} ORDER BY score DESC, id ASC LIMIT $2`, [mode, limit]);
      return r.rows.map(row => ({ id: row.id, score: row.score, wave: row.wave, party: row.party, at: row.created_at }));
    },
    async me(id) {
      const best = await pool.query(`SELECT mode, MAX(score) AS best, COUNT(*)::int AS runs, MAX(wave) AS best_wave FROM runs WHERE $1 = ANY(player_ids) GROUP BY mode`, [id]);
      const out = {};
      for (const row of best.rows) {
        const rank = await pool.query('SELECT COUNT(*)::int + 1 AS rank FROM runs WHERE mode=$1 AND score > $2', [row.mode, row.best]);
        out[row.mode] = { best: Number(row.best), runs: row.runs, bestWave: Number(row.best_wave), rank: rank.rows[0].rank };
      }
      return out;
    },
  };
}

// ---------- JSON 檔 ----------
function createFileStore() {
  let data = { players: {}, runs: [], nextRun: 1 };
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(data)); } catch (e) { console.error('store save failed', e.message); } }, 200); };
  const inPeriod = (r, period) => period !== 'week' || Date.now() - new Date(r.at).getTime() < WEEK_MS;
  const rankOf = (mode, score) => data.runs.filter(r => r.mode === mode && r.score > score).length + 1;
  return {
    kind: 'file',
    async register(name) {
      const id = crypto.randomBytes(8).toString('base64url'), secret = crypto.randomBytes(24).toString('base64url');
      data.players[id] = { id, secretHash: hash(secret), name, createdAt: new Date().toISOString() };
      save(); return { id, secret, name };
    },
    async auth(id, secret) { const p = data.players[id]; return p && p.secretHash === hash(secret) ? { id, name: p.name } : null; },
    async rename(id, name) { if (data.players[id]) { data.players[id].name = name; save(); } },
    async addRun({ mode, score, wave, party }) {
      const run = { id: data.nextRun++, mode, score, wave, party, ids: party.map(p => p.id).filter(Boolean), at: new Date().toISOString() };
      data.runs.push(run); if (data.runs.length > 5000) data.runs.splice(0, data.runs.length - 5000);
      save(); return { id: run.id, rank: rankOf(mode, score) };
    },
    async deleteOwnRun(runId, playerId) {
      const i = data.runs.findIndex(r => r.id === runId && r.mode === 'solo' && r.ids.includes(playerId));
      if (i < 0) return false;
      data.runs.splice(i, 1); save(); return true;
    },
    async top(mode, period, limit = 20) {
      return data.runs.filter(r => r.mode === mode && r.score >= MIN_RUN_SCORE && inPeriod(r, period)).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limit).map(r => ({ id: r.id, score: r.score, wave: r.wave, party: r.party, at: r.at }));
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
