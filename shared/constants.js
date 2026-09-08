// 遊戲規則常數：瀏覽器與伺服器共用。所有平衡數值集中在這裡調整。
import { rand, TAU } from './math.js';

/** 固定的邏輯世界尺寸。所有玩家不論螢幕大小都看到同一個世界，畫面用等比縮放加黑邊。 */
export const WORLD = { W: 1600, H: 900 };

/** 伺服器模擬頻率（每秒 tick 數）。單機模式用 requestAnimationFrame，這個值留給多人版。 */
export const TICK_RATE = 30;

export const MAX_PLAYERS = 4;
export const NAME_MAX_LEN = 12;

/** 每位玩家的辨識色（依加入順序分配） */
export const PLAYER_COLORS = ['#4cc9f0', '#f9c74f', '#90f1a8', '#f48fb1'];

export const PLAYER_BASE = {
  r: 14, hp: 100, maxHp: 100,
  fireRate: 0.16, damage: 8, spread: 1,          // 火力下修：原本 0.14 / 10
  accel: 1800, maxSpeed: 320,
  dashSpeed: 900, dashTime: 0.18, dashCd: 1.2,
  blinkDist: 240, blinkCd: 3, blinkInv: 0.45,   // 閃現（空白鍵）：瞬移一段距離，過程無敵
  bulletSpeed: 760, bulletLife: 1.2,
  magnetR: 120,
  laserDps: 7, laserRange: 720, laserTime: 5,    // 雷射道具：每秒傷害 = damage × laserDps，穿透路徑上所有敵人
};

export const ENEMY_TYPES = {
  drifter:  { r: 19, hp: 22, speed: 70,  color: '#ff5f7a', score: 10, kind: 'chase', contact: 18 },
  dart:     { r: 12, hp: 12, speed: 210, color: '#ffd166', score: 15, kind: 'chase', contact: 12 },
  tank:     { r: 34, hp: 110, speed: 40, color: '#9b5de5', score: 40, kind: 'chase', contact: 30 },
  shooter:  { r: 18, hp: 34, speed: 60,  color: '#00f5d4', score: 30, kind: 'orbit', contact: 18 },
  splitter: { r: 26, hp: 50, speed: 55,  color: '#f15bb5', score: 25, kind: 'chase', contact: 18, split: true },
  rock:     { r: 44, hp: 60, speed: 90,  color: '#b8b8c8', score: 8,  kind: 'drift', contact: 15 },
  lancer:   { r: 20, hp: 46, speed: 75,  color: '#e040fb', score: 45, kind: 'lancer', contact: 18 },   // 雷射兵：遠距預警後發射貫穿雷射
  bounty:   { r: 24, hp: 240, speed: 250, color: '#ffd166', score: 300, kind: 'flee', contact: 20 },   // 懸賞目標：逃跑、閃現、還擊
};

/** 難度曲線：隨波次成長的倍率（玩家升級變強，敵人也要跟上） */
export const DIFFICULTY = {
  hpPerWave: 0.16,        // 每波血量 +16%
  speedPerWave: 0.035,    // 每波速度 +3.5%
  baseCount: 5,           // 第一波基礎敵人數
  sizePerWave: 0.025,     // 每波體型 +2.5%（上限 +60%）
  sizeCap: 0.6,
  countPerWave: 2,        // 每波敵人數 +2
  eliteFromWave: 4,       // 從第 4 波起出現精英（1.5 倍體型、3 倍血量、必掉道具）
  eliteChance: w => Math.min(0.3, 0.06 + w * 0.015),
  shooterVolley: w => Math.min(4, 1 + Math.floor(w / 3)),   // 射手每次發射的子彈數上限（實際為 1..此值隨機）
  leadFromWave: 5,        // 射手從第 5 波起會預判玩家移動方向射擊
  dodgeFromWave: 3,       // 射手 / 雷射兵從第 3 波起、追擊者從第 5 波起會側移閃避來襲子彈
  chaserDodgeFromWave: 5,
  pickupHuntFromWave: 3,  // 敵人從第 3 波起會跟玩家搶道具吃（吃到有 Buff）
  mineFromWave: 8,        // 射手從第 8 波起會在身後佈雷
  lancerFromWave: 5,      // 雷射兵從第 5 波起出現
  pincerFromWave: 6,      // 從第 6 波起有 50% 機率改成兩側夾擊隊形
};

/** 敵人 AI 參數 */
export const AI = {
  flankTurn: 0.9,                 // 追擊者遠距離時的包抄轉角（弧度，越大越會繞側面）
  dartLungeCd: [2.2, 3.8],        // 飛鏢突進的間隔（秒）
  dartLungeTime: 0.45, dartLungeSpeed: 2.6,
  shooterRange: [300, 460],       // 射手保持的距離帶
  lancerRange: [380, 560],
  laserWarn: 1.1, laserFire: 0.35, laserLen: 900, laserWidth: 14, laserDmg: 22, laserCd: [4, 6],
  bossLaserWarn: 1.0, bossLaserFire: 1.4, bossLaserSweep: 1.3, bossLaserWidth: 26, bossLaserDmg: 25,
  dodgeCd: 1.2, dodgeRange: 150, dodgePush: 420,
  mineCd: [4, 6], mineLife: 7, mineTrigger: 70, mineShards: 8,
  bountyBlinkCd: 2.6, bountyBlinkDist: 350, bountyShootCd: 1.8,
};

export const BOSS_NAMES = ['殲滅者 Mk.I', '殲滅者 Mk.II', '殲滅者 Mk.III', '殲滅者 Ω'];
/** Boss 種類：每次 Boss 波隨機挑選；第 10 波起有機率同時兩隻（可相同可不同）。第 20 波固定殲滅者 Ω 壓軸。 */
export const BOSS_KINDS = {
  annihilator: { name: '殲滅者', color: '#ff3860', color2: '#ff8c42', r: 110, hpMul: 1,   speed: 1,   desc: '彈幕、彈牆、衝撞、雷射掃射' },
  hive:        { name: '蜂巢母艦', color: '#f15bb5', color2: '#c77dff', r: 120, hpMul: 1.1, speed: 0.6, desc: '召喚蟲群、外星飛碟與流星雨' },
  phantom:     { name: '幽影',   color: '#c77dff', color2: '#4cc9f0', r: 90,  hpMul: 0.8, speed: 1.5, desc: '隱形潛行、瞬移突襲、雷射' },
  titan:       { name: '星隕',   color: '#ff8c42', color2: '#ffd166', r: 135, hpMul: 1.4, speed: 0.45, desc: '呼叫隕石、衝擊波、厚重裝甲（受傷 -30%）' },
};
export const BOSS_DOUBLE_FROM_WAVE = 10;
export const BOSS_DOUBLE_CHANCE = 0.4;
/** 太空環境事件：流星與外星飛碟（第 3 波起，每 20–40 秒隨機一次） */
export const AMBIENT = { fromWave: 3, cd: [20, 40], meteorHp: 320, meteorSpeed: 300, meteorDmg: 30, meteorScore: 150, ufoHp: 160, ufoLife: 13, ufoShootCd: 0.7, ufoScore: 250, ufoDmg: 18, ufoToxicCd: 4.5,
  fleetFromWave: 8, fleetChance: 0.35, mothershipHp: 900, mothershipLife: 42, mothershipScore: 1000, toxicR: 110, toxicLife: 9, toxicDps: 12,
  doomWarn: 4, doomEvery: 12, doomMax: 3, safeZones: [2, 6], safeR: 95 };
export const ENEMY_BLINK_FROM_WAVE = 7;   // 飛鏢 / 射手從第 7 波起會閃現躲子彈
/** 無傷清波 / 擦彈加分 */
export const PERFECT_WAVE_BONUS = 120;   // × 波數
export const GRAZE_SCORE = 5;
export const BOSS_EVERY = 5;
export const BOSS_RADIUS = 110;   // 約原本的 2 倍

/** 通關波數：第 20 波的 Boss 擊破即「突圍成功」，可選擇繼續無盡模式 */
export const WIN_WAVE = 20;
export const WIN_BONUS = 5000;

/**
 * 組合技：兩個升級各至少 1 級即啟動（needs 為升級 id）。效果在 game.js 依 p.syn[id] 判斷。
 */
export const SYNERGIES = [
  { id: 'wall',     icon: '🧱', name: '彈幕牆',   needs: ['pierce', 'bounce'],     desc: '子彈撞牆反彈時分裂成兩發' },
  { id: 'vamp',     icon: '🩸', name: '吸血爆裂', needs: ['lifesteal', 'explosive'], desc: '連鎖爆裂每波及一個敵人回復 2 點生命' },
  { id: 'swarm',    icon: '🐝', name: '導引蜂群', needs: ['homing', 'drone'],      desc: '僚機射速加倍、子彈強力追蹤' },
  { id: 'shock',    icon: '⚡', name: '震撼彈',   needs: ['damage', 'bigshot'],    desc: '命中使敵人僵直 0.3 秒並大幅擊退' },
  { id: 'ember',    icon: '🔥', name: '餘燼',     needs: ['firerate', 'explosive'], desc: '15% 的子彈點燃敵人，3 秒內持續燃燒' },
  { id: 'ghost',    icon: '👻', name: '幽靈衝刺', needs: ['dash', 'speed'],        desc: '衝刺穿過的敵人受到 40 傷害，衝刺無敵延長' },
  { id: 'recharge', icon: '🔋', name: '護盾回充', needs: ['maxhp', 'lifesteal'],   desc: '每 20 次擊殺獲得一層護盾' },
];
/** 依玩家目前的升級等級算出啟動的組合技 id 陣列 */
export function activeSynergies(upgrades) { return SYNERGIES.filter(s => s.needs.every(id => (upgrades[id] || 0) > 0)).map(s => s.id); }
/** 選了 upgradeId 之後會新啟動的組合技（升級卡提示用） */
export function synergyIfPicked(upgrades, upgradeId) {
  return SYNERGIES.filter(s => s.needs.includes(upgradeId) && !(upgrades[upgradeId] > 0) && s.needs.every(id => id === upgradeId || (upgrades[id] || 0) > 0));
}

/** 升級節奏：每幾波給一次三選一（Boss 擊破後必給） */
export const UPGRADE_EVERY_WAVES = 2;

/** 特殊波次：固定排程 + 之後隨機 */
export const WAVE_MODES = {
  asteroids: { name: '小行星帶', desc: '擊碎小行星，碎片會分裂', duration: 0 },
  survive:   { name: '彈幕求生', desc: '閃避 20 秒，不需要攻擊', duration: 20 },
  defend:    { name: '防衛信標', desc: '守住中央信標 30 秒', duration: 30 },
  convoy:    { name: '護送運輸艦', desc: '護送運輸艦穿越戰區，別讓它被擊沉', duration: 0 },
  hunt:      { name: '懸賞獵殺', desc: '25 秒內擊殺會閃現逃跑的懸賞目標', duration: 25 },
};
export const MODE_SCHEDULE = { 3: 'asteroids', 4: 'survive', 6: 'hunt', 8: 'convoy', 9: 'defend', 12: 'asteroids' };   // 7、11 波保留為一般波，讓新敵種有機會登場
export const MODE_CHANCE_AFTER = 10;   // 第 10 波之後，非 Boss 波有 40% 機率是特殊波
export const MODE_CHANCE = 0.4;

/** 倒地救援 */
export const DOWNED_TIME = 30;      // 倒地後 30 秒無人救援即陣亡
export const REVIVE_RANGE = 70;
export const REVIVE_TIME = 3;
/** 排行榜最低有效分數（一次擊殺至少 10 分；低於此值的局不記錄、不顯示） */
export const MIN_RUN_SCORE = 10;
/** 斷線後保留角色的秒數 */
export const OFFLINE_GRACE = 15;

export const PICKUP_STYLE = {
  heal:   { color: '#3ddc84', label: '+HP' },
  spread: { color: '#ffd166', label: '散射' },
  rapid:  { color: '#ff8c42', label: '連射' },
  shield: { color: '#4cc9f0', label: '護盾' },
  bomb:   { color: '#ff3860', label: '炸彈' },
  laser:  { color: '#b8ffff', label: '雷射' },
};

/**
 * 升級定義。apply 只能修改玩家物件，不可碰任何環境（DOM、音效），這樣伺服器也能執行。
 */
export const UPGRADES = [
  { id: 'damage',    icon: '💥', name: '強化彈頭', max: 5, desc: l => `子彈傷害 +20%（目前 +${l * 20}%）`, apply: p => { p.damage *= 1.2; } },
  { id: 'firerate',  icon: '🔥', name: '高速裝填', max: 5, desc: l => `射速 +10%（目前 +${l * 10}%）`, apply: p => { p.fireRate *= 0.9; } },
  { id: 'pierce',    icon: '🎯', name: '穿甲彈',   max: 3, desc: l => `子彈可穿透 ${l + 1} 個敵人`, apply: p => { p.pierce++; } },
  { id: 'bounce',    icon: '🏓', name: '反彈彈',   max: 2, desc: l => `子彈撞牆反彈 ${l + 1} 次`, apply: p => { p.bounce++; } },
  { id: 'homing',    icon: '🧲', name: '追蹤導引', max: 3, desc: l => `子彈會微幅轉向最近的敵人（等級 ${l + 1}）`, apply: p => { p.homing++; } },
  { id: 'drone',     icon: '🛸', name: '無人僚機', max: 3, desc: l => `召喚一台自動射擊的僚機（${l + 1} 台）`, apply: p => { p.drones.push({ a: rand(0, TAU), cd: rand(0, 0.5), x: p.x, y: p.y }); } },
  { id: 'lifesteal', icon: '🩸', name: '汲血核心', max: 3, desc: l => `每次擊殺回復 ${(l + 1) * 2} 點生命`, apply: p => { p.lifesteal += 2; } },
  { id: 'explosive', icon: '☄️', name: '連鎖爆裂', max: 3, desc: l => `敵人死亡時對周圍造成 ${(l + 1) * 20} 傷害`, apply: p => { p.explosive += 20; } },
  { id: 'maxhp',     icon: '❤️', name: '裝甲強化', max: 5, desc: () => `最大生命 +25 並立即回滿`, apply: p => { p.maxHp += 25; p.hp = p.maxHp; } },
  { id: 'speed',     icon: '💨', name: '推進器',   max: 3, desc: l => `移動速度 +12%（目前 +${l * 12}%）`, apply: p => { p.speedMul *= 1.12; } },
  { id: 'dash',      icon: '⚡', name: '衝刺冷卻', max: 3, desc: () => `衝刺冷卻 -25%`, apply: p => { p.dashCdMax *= 0.75; } },
  { id: 'magnet',    icon: '🧭', name: '牽引光束', max: 2, desc: () => `道具吸附範圍加倍`, apply: p => { p.magnetR *= 2; } },
  { id: 'bigshot',   icon: '🔵', name: '巨型彈體', max: 2, desc: () => `子彈體積 +50%，更容易命中`, apply: p => { p.bulletSize += 0.5; } },
];

/**
 * 局外成長：永久強化（機庫）。用「星塵」購買，每局開始套用到玩家身上。
 * cost[等級-1] 為該級價格；apply(p, level) 只能改玩家物件（伺服器也會執行）。
 */
export const PERKS = [
  { id: 'armor',  icon: '🛡️', name: '裝甲塗層', max: 3, cost: [200, 400, 800],  desc: l => `最大生命 +${l * 10}`, apply: (p, l) => { p.maxHp += 10 * l; p.hp = p.maxHp; } },
  { id: 'shield', icon: '🔵', name: '起始護盾', max: 1, cost: [300],            desc: () => '每局開局自帶 1 層護盾', apply: (p, l) => { p.shield += l; } },
  { id: 'magnet', icon: '🧭', name: '牽引器',   max: 2, cost: [250, 500],       desc: l => `道具吸附範圍 +${l * 30}%`, apply: (p, l) => { p.magnetR *= 1 + 0.3 * l; } },
  { id: 'dash',   icon: '⚡', name: '推進冷卻', max: 2, cost: [350, 700],       desc: l => `衝刺冷卻 -${l * 10}%`, apply: (p, l) => { p.dashCdMax *= 1 - 0.1 * l; } },
  { id: 'luck',   icon: '🍀', name: '幸運星',   max: 2, cost: [400, 800],       desc: l => `道具掉落率 +${l * 25}%`, apply: (p, l) => { p.luck = 0.25 * l; } },
  { id: 'salvo',  icon: '💥', name: '預備彈頭', max: 1, cost: [600],            desc: () => '開局子彈傷害 +10%', apply: (p, l) => { p.damage *= 1 + 0.1 * l; } },
  { id: 'dust',   icon: '✨', name: '星塵收集', max: 2, cost: [500, 1000],      desc: l => `每局獲得星塵 +${l * 20}%`, apply: () => {} },
];
/**
 * 起始機體。獵鷹免費；其餘在機庫用星塵解鎖（unlocks 內存 'ship:<id>'）。
 * apply(p) 在 addPlayer 建立後、永久強化之前套用；只改玩家物件。
 * stats 給機庫顯示（1 = 基準）。
 */
export const SHIPS = [
  { id: 'falcon',  icon: '🚀', name: '獵鷹',   cost: 0,    desc: '均衡型，標準機體',
    stats: { hp: 1, speed: 1, fire: 1, dmg: 1 }, apply: () => {} },
  { id: 'wasp',    icon: '🐝', name: '黃蜂',   cost: 800,  desc: '極速輕型機：速度 +25%、射速 +25%、衝刺冷卻 0.8 秒；生命 70、傷害 -20%',
    stats: { hp: 0.7, speed: 1.25, fire: 1.25, dmg: 0.8 }, apply: p => { p.maxHp = 70; p.hp = 70; p.speedMul *= 1.25; p.fireRate *= 0.8; p.damage *= 0.8; p.dashCdMax = 0.8; p.r = 12; } },
  { id: 'bastion', icon: '🛡️', name: '堡壘',   cost: 800,  desc: '重裝機：生命 160、傷害 +30%、子彈體積 +50%；速度 -20%、射速 -25%、衝刺冷卻 1.6 秒',
    stats: { hp: 1.6, speed: 0.8, fire: 0.75, dmg: 1.3 }, apply: p => { p.maxHp = 160; p.hp = 160; p.speedMul *= 0.8; p.fireRate *= 1.33; p.damage *= 1.3; p.bulletSize += 0.5; p.dashCdMax = 1.6; p.r = 16; } },
  { id: 'carrier', icon: '🛸', name: '母艦',   cost: 1200, desc: '航艦：開局自帶 2 台僚機、生命 110；射速 -15%、傷害 -10%',
    stats: { hp: 1.1, speed: 0.95, fire: 0.85, dmg: 0.9 }, apply: p => { p.maxHp = 110; p.hp = 110; p.speedMul *= 0.95; p.fireRate *= 1.18; p.damage *= 0.9; for (let i = 0; i < 2; i++) p.drones.push({ a: i * Math.PI, cd: 0.2 * i, x: p.x, y: p.y }); } },
];
/** 塗裝：純外觀，用星塵解鎖（unlocks 內存 'skin:<id>'）。hull 機身、stroke 輪廓、glow 光暈；null 用玩家辨識色 */
export const SKINS = [
  { id: 'classic', icon: '⬜', name: '標準',   cost: 0,   hull: '#e8f6ff', stroke: null, glow: null },
  { id: 'ember',   icon: '🟧', name: '餘燼',   cost: 500, hull: '#ffe0c2', stroke: '#ff8c42', glow: '#ff8c42' },
  { id: 'frost',   icon: '⬜', name: '霜白',   cost: 500, hull: '#ffffff', stroke: '#b8ffff', glow: '#b8ffff' },
  { id: 'gold',    icon: '🟨', name: '鎏金',   cost: 800, hull: '#fff3c4', stroke: '#ffd166', glow: '#ffd166' },
  { id: 'void',    icon: '🟪', name: '虛空',   cost: 800, hull: '#2a1440', stroke: '#c77dff', glow: '#c77dff', dash: true },
  { id: 'toxic',   icon: '🟩', name: '毒液',   cost: 800, hull: '#d7ffe0', stroke: '#3ddc84', glow: '#3ddc84' },
];
export function skinById(id) { return SKINS.find(s => s.id === id) || SKINS[0]; }
export function skinUnlocked(id, unlocks) { return id === 'classic' || (unlocks || []).includes('skin:' + id); }

/**
 * 改裝：主武器。脈衝砲免費；其餘在機庫用星塵解鎖（unlocks 內存 'weapon:<id>'）。
 * 子彈類升級（穿甲 / 反彈 / 追蹤 / 巨型彈體 / 散射道具）只對脈衝砲有效；傷害與射速升級對全部有效。
 */
export const WEAPONS = [
  { id: 'blaster', icon: '🔫', name: '脈衝砲',   cost: 0,    desc: '標準連射子彈，所有子彈升級都有效' },
  { id: 'flame',   icon: '🔥', name: '火焰槍',   cost: 900,  desc: '近距離扇形持續噴射，碰到的敵人全部點燃；射程短' },
  { id: 'frost',   icon: '❄️', name: '冰凍光線', cost: 900,  desc: '中距離光束，命中減速，連續照射 2 秒凍結；傷害較低' },
  { id: 'arc',     icon: '⚡', name: '閃電鏈',   cost: 1200, desc: '自動命中最近的敵人並連鎖跳到最多 4 個目標；射速較慢' },
  { id: 'laser',   icon: '🔆', name: '雷射砲',   cost: 1000, desc: '按住持續射出貫穿光束，命中路徑上所有敵人；傷害隨傷害升級成長' },
];
export const WEAPON_STATS = { laserDps: 3.2, flameRange: 250, flameCone: 0.4, flameDps: 4.5, frostRange: 520, frostDps: 2.4, frostSlow: 0.4, frostFreezeAfter: 2, arcRange: 380, arcJump: 210, arcTargets: 4, arcDmg: 2.6, arcRate: 2.4 };
export function weaponById(id) { return WEAPONS.find(w => w.id === id) || WEAPONS[0]; }
export function weaponUnlocked(id, unlocks) { return id === 'blaster' || (unlocks || []).includes('weapon:' + id); }

export function shipById(id) { return SHIPS.find(s => s.id === id) || SHIPS[0]; }
export function shipUnlocked(id, unlocks) { return id === 'falcon' || (unlocks || []).includes('ship:' + id); }
export function applyShip(p, shipId) { const s = shipById(shipId); s.apply(p); p.ship = s.id; }

/** unlocks 是 id 陣列（重複代表等級）→ {id: level} */
export function perkLevels(unlocks) {
  const out = {};
  for (const id of unlocks || []) out[id] = (out[id] || 0) + 1;
  return out;
}
/** 把永久強化套用到剛建立的玩家 */
export function applyPerks(p, unlocks) {
  const lv = perkLevels(unlocks);
  for (const k of PERKS) if (lv[k.id]) k.apply(p, Math.min(lv[k.id], k.max));
  p.perks = unlocks ? unlocks.slice() : [];
}
/** 一局可獲得的星塵：分數 / 25 + 每波 5，星塵收集加成後上限 2000 */
export function dustFor(score, wave, unlocks) {
  const lv = perkLevels(unlocks).dust || 0;
  return Math.min(2000, Math.round((Math.floor(score / 25) + wave * 5) * (1 + 0.2 * lv)));
}

/** 名字清理：去頭尾空白、限制長度、只保留可見字元 */
export function sanitizeName(raw) {
  const s = String(raw || '').replace(/[ -]/g, '').trim().slice(0, NAME_MAX_LEN);
  return s || '無名飛行員';
}
