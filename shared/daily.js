// 每日挑戰：以日期為種子，每天固定兩個規則與固定的敵人組合；一個帳號一天只能挑戰一次。
// 瀏覽器與伺服器共用，雙方各自算出同一份規則（伺服器只用來驗證日期與紀錄）。
import { hashString } from './math.js';

/** 規則清單。apply 在 startRun 時改 world.mods（由 game.js 讀取），不直接碰環境。 */
export const DAILY_MODS = [
  { id: 'fast',     icon: '💨', name: '極速敵群', desc: '敵人速度 +30%' },
  { id: 'elite',    icon: '👑', name: '精英出沒', desc: '精英出現機率 3 倍' },
  { id: 'noPickup', icon: '🚫', name: '物資匱乏', desc: '敵人不掉落道具' },
  { id: 'glass',    icon: '🔮', name: '玻璃大砲', desc: '生命減半，子彈傷害 +50%' },
  { id: 'lancers',  icon: '🔦', name: '雷射封鎖', desc: '雷射兵從第 2 波起出現且數量加倍' },
  { id: 'swarm',    icon: '🐝', name: '蟲潮',     desc: '敵人數 +50%，血量 -25%' },
  { id: 'skip',     icon: '🚀', name: '深空突入', desc: '從第 4 波開始' },
  { id: 'mines',    icon: '💣', name: '雷區',     desc: '射手從第 1 波起就會佈雷' },
];

/** 今天的日期鍵（台灣時間 UTC+8），例如 2026-09-07 */
export function dayKey(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 由日期鍵算出當天的挑戰：種子 + 兩個不重複的規則 */
export function dailyChallenge(key = dayKey()) {
  const seed = hashString('stardust-daily-' + key);
  const pool = DAILY_MODS.slice();
  const mods = [];
  let a = seed;
  const next = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  while (mods.length < 2 && pool.length) mods.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  return { key, seed, mods };
}
