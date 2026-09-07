// 遊玩數據聚合：把事件列（events）算成儀表板要的統計。純函式，Postgres 與 JSON 檔兩種資料層共用。
// 事件名稱（客戶端 public/js/analytics.js 與伺服器都會送）：
//   session   { device: 'touch'|'desktop' }
//   run_start { mode: solo|daily|coop, ship, wave0 }
//   run_end   { mode, ship, wave, score, reason: dead|abandon|victory|endless|left, dur（秒）, kills, ups（升級 id 陣列）, syn（組合技 id 陣列） }
//   upgrade   { id, wave }
//   perk_buy  { perk }
//   daily_start {}
//   room      { kind: create|join|midjoin, players }
import { SHIPS, UPGRADES, SYNERGIES, WIN_WAVE } from '../shared/constants.js';

const DAY = 24 * 3600 * 1000;
const dayOf = ts => new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);   // 台灣時間
const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const r1 = v => Math.round(v * 10) / 10;

export function computeStats(rows, now = Date.now()) {
  const ends = rows.filter(e => e.name === 'run_end');
  const starts = rows.filter(e => e.name === 'run_start');
  const sessions = rows.filter(e => e.name === 'session');
  const byDay = {};
  const playersByDay = {};
  for (const e of rows) {
    const d = dayOf(e.at);
    byDay[d] ??= { day: d, sessions: 0, runs: 0, players: new Set() };
    if (e.name === 'session') byDay[d].sessions++;
    if (e.name === 'run_end') byDay[d].runs++;
    if (e.acct) { byDay[d].players.add(e.acct); (playersByDay[e.acct] ??= new Set()).add(d); }
  }
  const days = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)).slice(-30).map(d => ({ day: d.day, sessions: d.sessions, runs: d.runs, players: d.players.size }));

  const uniq = (sinceDays) => new Set(rows.filter(e => e.acct && now - e.at < sinceDays * DAY).map(e => e.acct)).size;
  const waves = ends.map(e => Number(e.props.wave) || 0);
  const modes = {};
  for (const e of ends) { const m = e.props.mode || 'solo'; modes[m] ??= { runs: 0, waves: [], scores: [], durs: [] }; modes[m].runs++; modes[m].waves.push(Number(e.props.wave) || 0); modes[m].scores.push(Number(e.props.score) || 0); if (e.props.dur) modes[m].durs.push(Number(e.props.dur)); }
  const modeStats = Object.fromEntries(Object.entries(modes).map(([m, v]) => [m, { runs: v.runs, avgWave: r1(avg(v.waves)), medianWave: median(v.waves), avgScore: Math.round(avg(v.scores)), avgDur: Math.round(avg(v.durs)) }]));

  // 流失點：每一波有多少局在這裡結束（只算真的死掉的局）
  const deathWave = {};
  for (const e of ends) if (e.props.reason === 'dead' || e.props.reason === 'endless') { const w = Math.min(WIN_WAVE + 5, Number(e.props.wave) || 0); deathWave[w] = (deathWave[w] || 0) + 1; }
  const deathHist = Array.from({ length: WIN_WAVE + 6 }, (_, w) => ({ wave: w, runs: deathWave[w] || 0 }));
  // 到達率：有多少比例的局撐到第 w 波
  const reach = Array.from({ length: WIN_WAVE + 1 }, (_, w) => ({ wave: w, pct: ends.length ? Math.round(100 * ends.filter(e => (Number(e.props.wave) || 0) >= w).length / ends.length) : 0 }));
  const reasons = {};
  for (const e of ends) reasons[e.props.reason || 'dead'] = (reasons[e.props.reason || 'dead'] || 0) + 1;

  const ships = SHIPS.map(s => { const rs = ends.filter(e => (e.props.ship || 'falcon') === s.id); return { id: s.id, name: s.name, icon: s.icon, runs: rs.length, avgWave: r1(avg(rs.map(e => Number(e.props.wave) || 0))), avgScore: Math.round(avg(rs.map(e => Number(e.props.score) || 0))) }; });
  const upPicks = rows.filter(e => e.name === 'upgrade');
  const upgrades = UPGRADES.map(u => ({ id: u.id, icon: u.icon, name: u.name, picks: upPicks.filter(e => e.props.id === u.id).length })).sort((a, b) => b.picks - a.picks);
  const synergies = SYNERGIES.map(s => ({ id: s.id, icon: s.icon, name: s.name, runs: ends.filter(e => Array.isArray(e.props.syn) && e.props.syn.includes(s.id)).length }));
  const device = { touch: sessions.filter(e => e.props.device === 'touch').length, desktop: sessions.filter(e => e.props.device !== 'touch').length };
  const perkBuys = rows.filter(e => e.name === 'perk_buy').length;
  const dailyStarts = rows.filter(e => e.name === 'daily_start').length;
  const rooms = rows.filter(e => e.name === 'room');
  // 留存：有帳號的玩家中，玩過 2 天以上 / 7 天內回來過
  const retained = Object.values(playersByDay).filter(s => s.size >= 2).length;
  const accounts = Object.keys(playersByDay).length;

  return {
    generatedAt: new Date(now).toISOString(), events: rows.length,
    players: { all: accounts, d7: uniq(7), d30: uniq(30), retained2days: retained, retentionPct: accounts ? Math.round(100 * retained / accounts) : 0 },
    runs: { total: ends.length, started: starts.length, avgWave: r1(avg(waves)), medianWave: median(waves), victories: ends.filter(e => e.props.reason === 'victory' || e.props.reason === 'endless').length, reasons },
    modes: modeStats, days, deathHist, reach, ships, upgrades, synergies, device, perkBuys, dailyStarts,
    rooms: { created: rooms.filter(e => e.props.kind === 'create').length, joins: rooms.filter(e => e.props.kind === 'join').length, midJoins: rooms.filter(e => e.props.kind === 'midjoin').length },
  };
}
