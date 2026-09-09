// 成就、每日 / 每週任務、圖鑑進度。瀏覽器與伺服器共用：伺服器用它驗證並發星塵，客戶端用它顯示進度。
// 一局的統計來自 game.js 的 world.stats（freshStats），任務與成就都只看這個物件 + 幾個局外欄位。
import { hashString } from './math.js';
import { ARENAS, WEAPONS } from './constants.js';

/** 一局結束時客戶端送來的摘要（伺服器只信這些欄位） */
export function runSummary(world, ctx = {}) {
  const st = world.stats || {};
  return {
    wave: world.wave, won: !!world.won, endless: !!world.endless, coop: !!ctx.coop, arena: world.arena, ship: ctx.ship || null, weapon: ctx.weapon || null, hour: ctx.hour ?? new Date().getHours(), players: world.players.length,
    kills: st.kills || {}, elites: st.elites || 0, bosses: st.bosses || 0, blinks: st.blinks || 0, dashes: st.dashes || 0, pickups: st.pickups || 0, grazes: st.grazes || 0, maxCombo: st.maxCombo || 0, swings: st.swings || 0, parries: st.parries || 0,
    bestNoFire: st.bestNoFire || 0, bestNoHit: st.bestNoHit || 0, bestStill: st.bestStill || 0, upgrades: st.upgrades || 0, crateHp: st.crateHp ?? -1, doomSurvived: !!st.doomSurvived, kamiKills: st.kamiKills || 0, sniperKills: st.sniperKills || 0,
    weaponKills: st.weaponKills || {}, evolved: st.evolved || null, hoard: st.hoard || 0, events: st.events || [], bossesSeen: st.bossesSeen || [], doubleBoss: !!st.doubleBoss, dmgDealt: Math.round(st.dmgDealt || 0), dmgTaken: Math.round(st.dmgTaken || 0), timeAlive: Math.round(st.timeAlive || 0),
  };
}
const totalKills = r => Object.values(r.kills || {}).reduce((a, b) => a + b, 0);

/**
 * 成就。check(run, prog) → boolean；run 是 runSummary，prog 是累計進度（伺服器 meta.prog）。
 * 特別一點的：不開火、不受傷、不動、格擋、被毀滅波打到剩 1 血還撐過、半夜玩……
 */
export const ACHIEVEMENTS = [
  { id: 'pacifist',   icon: '🕊️', name: '和平主義者', desc: '第 3 波之後，敵人在場時連續 30 秒不開火', dust: 300, check: r => r.bestNoFire >= 30 && r.wave >= 3 },
  { id: 'untouchable', icon: '👻', name: '碰不到我',   desc: '一局內連續 90 秒不受任何傷害（毒區也算）', dust: 300, check: r => r.bestNoHit >= 90 },
  { id: 'statue',     icon: '🗿', name: '靜止的機體', desc: '第 2 波之後，20 秒完全不動也不開火', dust: 250, check: r => r.bestStill >= 20 && r.wave >= 2 },
  { id: 'grazer',     icon: '🌬️', name: '貼身舞者',   desc: '一局擦彈 60 次', dust: 250, check: r => r.grazes >= 60 },
  { id: 'parry',      icon: '🗡️', name: '劍聖之道',   desc: '一局用光刃或堡壘正面盾格擋 50 顆子彈', dust: 300, check: r => r.parries >= 50 },
  { id: 'blinker',    icon: '✨', name: '閃現狂',     desc: '一局閃現 40 次', dust: 200, check: r => r.blinks >= 40 },
  { id: 'naked',      icon: '🧦', name: '裸裝突圍',   desc: '每次升級都按「放棄升級」，還是打過第 5 波的 Boss', dust: 500, check: r => r.wave >= 6 && r.upgrades === 0 },
  { id: 'doom',       icon: '☢️', name: '只剩一滴血', desc: '被母艦毀滅攻擊打到剩 1 血，仍撐過那一波', dust: 400, check: r => r.doomSurvived },
  { id: 'hoarder',    icon: '🎒', name: '囤積者',     desc: '10 秒內撿 6 個道具', dust: 200, check: r => r.hoard >= 6 || false },
  { id: 'counter',    icon: '🎯', name: '反狙擊',     desc: '狙擊手瞄準你的那 1.4 秒內把它擊落', dust: 250, check: r => r.sniperKills >= 1 },
  { id: 'combo100',   icon: '🔥', name: '百連',       desc: '單局 100 連擊', dust: 400, check: r => r.maxCombo >= 100 },
  { id: 'nightowl',   icon: '🦉', name: '夜貓子',     desc: '凌晨 2 到 4 點之間打完一局', dust: 150, check: r => r.hour >= 2 && r.hour < 4 },
  { id: 'kamikaze',   icon: '💥', name: '以彼之道',   desc: '一局內讓自爆蟲炸死 5 隻其他敵人', dust: 250, check: r => r.kamiKills >= 5 },
  { id: 'courier',    icon: '📦', name: '快遞員',     desc: '補給空投一滴血都沒掉', dust: 250, check: r => r.crateHp === 1 },
  { id: 'evolved',    icon: '🧬', name: '進化論',     desc: '第一次讓武器進化', dust: 200, check: r => !!r.evolved },
  { id: 'breakout',   icon: '🏁', name: '突圍者',     desc: '通關第 20 波', dust: 500, check: r => r.won },
  { id: 'endless30',  icon: '♾️', name: '無盡三十',   desc: '無盡模式撐到第 30 波', dust: 800, check: r => r.wave >= 30 },
  { id: 'coopwin',    icon: '🤝', name: '同舟共濟',   desc: '合作模式通關', dust: 500, check: r => r.won && r.coop },
  { id: 'twins',      icon: '👯', name: '雙殺',       desc: '同時擊破兩隻 Boss', dust: 400, check: r => r.doubleBoss },
  { id: 'sunk',       icon: '🛸', name: '擊沉母艦',   desc: '擊沉飛碟母艦', dust: 300, check: r => (r.kills.mothership || 0) >= 1 },
  { id: 'chaos',      icon: '🎲', name: '混沌之夜',   desc: '一局遇到 5 種不同的隨機事件', dust: 300, check: r => new Set(r.events).size >= 5 },
  { id: 'untouched5', icon: '🛡️', name: '零受傷 Boss', desc: '整局承受傷害為 0 且擊破至少一隻 Boss', dust: 600, check: r => r.dmgTaken === 0 && r.bosses >= 1 },
  // 累計型（看 prog）
  { id: 'traveler',   icon: '🗺️', name: '星際旅人',   desc: '六個場地各撐過第 10 波（累計）', dust: 600, check: (r, prog) => ARENAS.every(a => (prog.arenas?.[a.id] || 0) >= 10) },
  { id: 'elementalist', icon: '🔮', name: '屬性大師', desc: '五種不同武器各累計擊殺 500', dust: 800, check: (r, prog) => Object.values(prog.weaponKills || {}).filter(n => n >= 500).length >= 5 },
  { id: 'veteran',    icon: '🎖️', name: '老兵',       desc: '累計擊殺 5000', dust: 500, check: (r, prog) => (prog.kills || 0) >= 5000 },
];

/** 任務池：stat 對 runSummary 取值；weekly 任務目標 ×3 且跨局累加 */
export const QUESTS = [
  { id: 'kills', icon: '💀', name: '清理戰場', desc: '擊殺 {n} 隻敵人', goal: 120, dust: 120, val: r => totalKills(r) },
  { id: 'wave8', icon: '🌊', name: '撐下去', desc: '單局撐到第 {n} 波', goal: 8, dust: 150, val: r => r.wave, max: true },
  { id: 'grazes', icon: '🌬️', name: '擦身而過', desc: '擦彈 {n} 次', goal: 25, dust: 120, val: r => r.grazes },
  { id: 'blinks', icon: '✨', name: '瞬移大師', desc: '閃現 {n} 次', goal: 20, dust: 100, val: r => r.blinks },
  { id: 'pickups', icon: '🎁', name: '補給官', desc: '撿起 {n} 個道具', goal: 15, dust: 100, val: r => r.pickups },
  { id: 'boss', icon: '👹', name: '獵殺巨艦', desc: '擊破 {n} 隻 Boss', goal: 2, dust: 200, val: r => r.bosses },
  { id: 'kami', icon: '💥', name: '拆彈專家', desc: '擊落 {n} 隻自爆蟲', goal: 15, dust: 120, val: r => (r.kills.kamikaze || 0) + (r.kills.ember || 0) },
  { id: 'sniper', icon: '🎯', name: '反狙擊小隊', desc: '擊落 {n} 隻狙擊手', goal: 6, dust: 150, val: r => r.kills.sniper || 0 },
  { id: 'warden', icon: '🛡', name: '繞到背後', desc: '擊落 {n} 隻護盾兵', goal: 8, dust: 150, val: r => r.kills.warden || 0 },
  { id: 'elite', icon: '👑', name: '精英獵人', desc: '擊落 {n} 隻精英', goal: 5, dust: 150, val: r => r.elites },
  { id: 'inferno', icon: '🌋', name: '火焰行者', desc: '在火焰星球撐到第 {n} 波', goal: 6, dust: 150, val: r => r.arena === 'inferno' ? r.wave : 0, max: true },
  { id: 'abyss', icon: '🌊', name: '深潛', desc: '在深海撐到第 {n} 波', goal: 6, dust: 150, val: r => r.arena === 'abyss' ? r.wave : 0, max: true },
  { id: 'glacier', icon: '🧊', name: '冰上芭蕾', desc: '在冰封星撐到第 {n} 波', goal: 6, dust: 150, val: r => r.arena === 'glacier' ? r.wave : 0, max: true },
  { id: 'venom', icon: '☣️', name: '毒中求生', desc: '在毒物星撐到第 {n} 波', goal: 6, dust: 150, val: r => r.arena === 'venom' ? r.wave : 0, max: true },
  { id: 'mercury', icon: '☀️', name: '日光浴', desc: '在水星撐到第 {n} 波', goal: 6, dust: 150, val: r => r.arena === 'mercury' ? r.wave : 0, max: true },
  { id: 'flame', icon: '🔥', name: '燒烤時間', desc: '用火焰槍擊殺 {n} 隻', goal: 60, dust: 150, val: r => r.weaponKills.flame || 0 },
  { id: 'frost', icon: '❄️', name: '冷凍庫', desc: '用冰凍光線擊殺 {n} 隻', goal: 60, dust: 150, val: r => r.weaponKills.frost || 0 },
  { id: 'arc', icon: '⚡', name: '雷神', desc: '用閃電鏈擊殺 {n} 隻', goal: 60, dust: 150, val: r => r.weaponKills.arc || 0 },
  { id: 'blade', icon: '🗡️', name: '近身戰', desc: '用光刃擊殺 {n} 隻', goal: 50, dust: 150, val: r => r.weaponKills.blade || 0 },
  { id: 'parry', icon: '🛡️', name: '格擋練習', desc: '格擋 {n} 顆子彈', goal: 20, dust: 120, val: r => r.parries },
  { id: 'combo', icon: '🔥', name: '連擊', desc: '達成 {n} 連擊', goal: 40, dust: 120, val: r => r.maxCombo, max: true },
  { id: 'events', icon: '🎲', name: '事件觀察員', desc: '遇到 {n} 個隨機事件', goal: 3, dust: 120, val: r => r.events.length },
  { id: 'evolve', icon: '🧬', name: '進化', desc: '讓武器進化 {n} 次', goal: 1, dust: 200, val: r => r.evolved ? 1 : 0 },
  { id: 'nofire', icon: '🕊️', name: '忍住', desc: '敵人在場時連續 {n} 秒不開火', goal: 15, dust: 150, val: r => r.bestNoFire, max: true },
  { id: 'nohit', icon: '👻', name: '滑溜', desc: '連續 {n} 秒不受傷', goal: 45, dust: 150, val: r => r.bestNoHit, max: true },
  { id: 'coop', icon: '🤝', name: '一起上', desc: '合作模式打 {n} 局', goal: 1, dust: 150, val: r => r.coop ? 1 : 0 },
];
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function pick(seedStr, n) { const rng = seeded(hashString(seedStr)); const pool = QUESTS.slice(); const out = []; while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]); return out; }
/** 今天的每日任務（3 個）與本週的每週任務（3 個，目標 ×3、跨局累加） */
export function dailyQuests(dayKey) { return pick('quest-day-' + dayKey, 3).map(q => ({ ...q, goal: q.goal, period: 'day' })); }
export function weeklyQuests(weekKey) { return pick('quest-week-' + weekKey, 3).map(q => ({ ...q, goal: q.max ? Math.round(q.goal * 1.5) : q.goal * 3, dust: q.dust * 3, period: 'week' })); }
export function questText(q) { return q.desc.replace('{n}', q.goal); }

/** 週鍵：台灣時間、週一開始（例如 2026-09-07） */
export function weekKey(now = Date.now()) {
  const d = new Date(now + 8 * 3600 * 1000);
  const day = (d.getUTCDay() + 6) % 7;   // 週一 = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
export function weekStartMs(now = Date.now()) { return Date.parse(weekKey(now) + 'T00:00:00+08:00'); }

/**
 * 把一局套進 meta（伺服器與客戶端預覽共用）。meta = { ach:[], prog:{}, daily:{key,prog,done}, weekly:{key,prog,done} }
 * 回傳 { ach:[新解鎖], quests:[新完成], dust:總星塵 }；會直接改 meta。
 */
export function applyRun(meta, run, dayKey, wKey) {
  meta.ach ||= []; meta.prog ||= {}; const prog = meta.prog;
  prog.kills = (prog.kills || 0) + totalKills(run);
  prog.weaponKills ||= {}; for (const [k, v] of Object.entries(run.weaponKills || {})) prog.weaponKills[k] = (prog.weaponKills[k] || 0) + v;
  prog.arenas ||= {}; if (run.arena) prog.arenas[run.arena] = Math.max(prog.arenas[run.arena] || 0, run.wave);
  prog.seen ||= { enemies: {}, bosses: {}, events: {} };
  for (const k of Object.keys(run.kills || {})) prog.seen.enemies[k] = true;
  for (const k of run.bossesSeen || []) prog.seen.bosses[k] = true;
  for (const k of run.events || []) prog.seen.events[k] = true;
  prog.runs = (prog.runs || 0) + 1;
  let dust = 0; const ach = [], quests = [];
  for (const a of ACHIEVEMENTS) { if (meta.ach.includes(a.id)) continue; let ok = false; try { ok = a.check(run, prog); } catch {} if (ok) { meta.ach.push(a.id); ach.push(a.id); dust += a.dust; } }
  const bucket = (slot, key, list) => {
    if (!meta[slot] || meta[slot].key !== key) meta[slot] = { key, prog: {}, done: [] };
    const b = meta[slot];
    for (const q of list) {
      if (b.done.includes(q.id)) continue;
      const v = q.val(run) || 0;
      b.prog[q.id] = slot === 'daily' ? Math.max(b.prog[q.id] || 0, v) : (q.max ? Math.max(b.prog[q.id] || 0, v) : (b.prog[q.id] || 0) + v);
      if (b.prog[q.id] >= q.goal) { b.done.push(q.id); quests.push(slot === 'daily' ? 'day:' + q.id : 'week:' + q.id); dust += q.dust; }
    }
  };
  bucket('daily', dayKey, dailyQuests(dayKey));
  bucket('weekly', wKey, weeklyQuests(wKey));
  return { ach, quests, dust };
}
