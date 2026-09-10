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
  // 每一種敵人都有自己的攻擊方式（沒有只會飄的）。name 給圖鑑 / 死亡畫面用
  drifter:  { r: 19, hp: 22, speed: 80,  color: '#ff5f7a', score: 10, kind: 'chase', contact: 18, name: '蟲群', atk: '貼近後衝撞，撞上就炸成碎片' },
  dart:     { r: 12, hp: 12, speed: 220, color: '#ffd166', score: 15, kind: 'chase', contact: 12, name: '飛鏢', atk: '繞飛後直線突進，第 7 波起會閃現躲子彈' },
  tank:     { r: 34, hp: 120, speed: 42, color: '#9b5de5', score: 40, kind: 'chase', contact: 30, name: '重裝', atk: '發射慢速重砲，死亡時放出震波環' },
  shooter:  { r: 18, hp: 34, speed: 62,  color: '#00f5d4', score: 30, kind: 'orbit', contact: 18, name: '射手', atk: '風箏射擊、預判、佈雷' },
  splitter: { r: 26, hp: 50, speed: 58,  color: '#f15bb5', score: 25, kind: 'chase', contact: 18, split: true, name: '分裂體', atk: '吐酸液（落地留小毒區），死後分裂' },
  rock:     { r: 44, hp: 60, speed: 90,  color: '#b8b8c8', score: 8,  kind: 'drift', contact: 15, name: '小行星', atk: '只在小行星帶出現的障礙' },
  warden:   { r: 22, hp: 70, speed: 55,  color: '#4cc9f0', score: 45, kind: 'warden', contact: 20, name: '護盾兵', atk: '正面能量盾擋子彈，要打側面或背後；三連發' },
  sniper:   { r: 16, hp: 30, speed: 90,  color: '#ff8c9c', score: 50, kind: 'sniper', contact: 12, name: '狙擊手', atk: '遠距瞄準 1.4 秒後高傷狙擊，射完閃現換位' },
  mortar:   { r: 24, hp: 55, speed: 45,  color: '#ffb347', score: 45, kind: 'mortar', contact: 18, name: '迫擊砲', atk: '朝你的預判位置投彈，地面先出現落點標記' },
  kamikaze: { r: 11, hp: 10, speed: 260, color: '#ff3860', score: 20, kind: 'kamikaze', contact: 8, name: '自爆蟲', atk: '高速接近，貼身自爆（也會炸到其他敵人）' },
  hexer:    { r: 20, hp: 45, speed: 70,  color: '#c77dff', score: 50, kind: 'hexer', contact: 15, name: '咒術師', atk: '在你腳下放減速咒印，並射出追蹤咒球' },
  // 各場地專屬
  sentinel: { r: 20, hp: 60, speed: 0,   color: '#c77dff', score: 55, kind: 'sentinel', contact: 15, name: '虛空哨兵', atk: '瞬移換位，射出會轉彎的虛空球；死後留下吸子彈的裂隙', element: 'void' },
  ember:    { r: 13, hp: 14, speed: 230, color: '#ff8c42', score: 22, kind: 'kamikaze', contact: 8, name: '餘燼', atk: '自爆並留下熔岩池', element: 'fire', lava: true },
  pulsar:   { r: 24, hp: 65, speed: 50,  color: '#ffd166', score: 55, kind: 'pulsar', contact: 18, name: '脈衝體', atk: '放出 EMP 環：被掃到會短暫不能衝刺與閃現', element: 'plasma' },
  spore:    { r: 26, hp: 60, speed: 35,  color: '#3ddc84', score: 40, kind: 'spore', contact: 15, name: '孢子母體', atk: '釋放追蹤孢子；死亡時炸出毒區', element: 'toxic' },
  angler:   { r: 28, hp: 95, speed: 45,  color: '#4cc9f0', score: 60, kind: 'angler', contact: 26, name: '燈籠魚', atk: '燈籠會把靠近的機體拉過去咬', element: 'water' },
  frostbite:{ r: 17, hp: 32, speed: 190, color: '#b8ffff', score: 35, kind: 'chase', contact: 12, name: '霜噬', atk: '撞到會讓你短暫凍住；射冰刺減速', element: 'ice', freezeTouch: true },
  lancer:   { r: 20, hp: 46, speed: 75,  color: '#e040fb', score: 45, kind: 'lancer', contact: 18, name: '雷射兵', atk: '遠距預警後發射貫穿雷射', element: 'plasma' },   // 雷射兵：遠距預警後發射貫穿雷射
  bounty:   { r: 24, hp: 240, speed: 250, color: '#ffd166', score: 300, kind: 'flee',   contact: 20, name: '懸賞目標', atk: '逃跑、閃現、還擊；限時擊殺有額外分數', element: 'neutral' },   // 懸賞目標：逃跑、閃現、還擊
};

/** 難度曲線：隨波次成長的倍率（玩家升級變強，敵人也要跟上） */
export const DIFFICULTY = {
  hpPerWave: 0.16,        // 每波血量 +16%
  speedPerWave: 0.045,    // 每波速度 +4.5%
  dmgPerWave: 0.05,       // 每波敵人攻擊力 +5%（上限 ×2.5）
  dmgCap: 2.5,
  perPlayer: { count: 0.6, hp: 0.45, dmg: 0.15, threat: 2 },   // 每多一位玩家：數量 +60%、血量 +45%、攻擊 +15%、AI 威脅等級 +2 波
  baseCount: 6,           // 第一波基礎敵人數
  sizePerWave: 0.025,     // 每波體型 +2.5%（上限 +60%）
  sizeCap: 0.6,
  countPerWave: 2.5,      // 每波敵人數 +2.5
  eliteFromWave: 3,       // 從第 3 波起出現精英（1.5 倍體型、3 倍血量、必掉道具、帶詞綴）
  eliteChance: w => Math.min(0.35, 0.08 + w * 0.018),
  affixFromWave: 8,       // 第 6 波起精英可能有兩個詞綴
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
export const ENEMY_BLINK_FROM_WAVE = 9;   // 飛鏢 / 射手從第 7 波起會閃現躲子彈
/** 無傷清波 / 擦彈加分 */
export const PERFECT_WAVE_BONUS = 120;   // × 波數
export const GRAZE_SCORE = 5;
export const BOSS_EVERY = 5;
/** Boss 挑戰：每一波都只出 Boss（1–6 隻隨機，越後面越多），連續 8 波通關；分數與星塵 ×1.5 */
export const BOSS_RUSH_WAVES = 8;
export const BOSS_RUSH_REWARD = 1.5;
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
  dust:   { color: '#fff3c4', label: '✨' },
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
  { id: 'shield', icon: '🔵', name: '起始護盾', max: 1, cost: [300],            desc: () => '每局開局自帶 1 層護盾', apply: (p, l) => { if (!p.flags || !p.flags.noShield) p.shield += l; } },
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
  { id: 'falcon',  icon: '🚀', name: '獵鷹',   cost: 0,    desc: '全能型。每選一次升級額外 +4% 傷害（適應力強）', trait: '適應力',
    stats: { hp: 1, speed: 1, fire: 1, dmg: 1 }, apply: p => { p.flags.adapt = true; } },
  { id: 'wasp',    icon: '🐝', name: '黃蜂',   cost: 800,  desc: '閃現刺客：閃現冷卻 1.2 秒，落點爆炸造成 40 傷害；速度 / 射速 +25%；生命 70、傷害 -20%、撿不到護盾', trait: '閃現打擊',
    stats: { hp: 0.7, speed: 1.25, fire: 1.25, dmg: 0.8 }, apply: p => { p.maxHp = 70; p.hp = 70; p.speedMul *= 1.25; p.fireRate *= 0.8; p.damage *= 0.8; p.dashCdMax = 0.8; p.blinkCdMax = 1.2; p.r = 12; p.flags.blinkStrike = true; p.flags.noShield = true; } },
  { id: 'bastion', icon: '🛡️', name: '堡壘',   cost: 800,  desc: '重裝：生命 170、傷害 +30%，正面 120° 能量盾擋住敵彈；閃現變成盾擊（短距衝撞、擊退並傷害）；速度 -20%、射速 -25%', trait: '正面護盾',
    stats: { hp: 1.7, speed: 0.8, fire: 0.75, dmg: 1.3 }, apply: p => { p.maxHp = 170; p.hp = 170; p.speedMul *= 0.8; p.fireRate *= 1.33; p.damage *= 1.3; p.bulletSize += 0.3; p.dashCdMax = 1.6; p.r = 16; p.flags.frontShield = true; p.flags.shieldBash = true; } },
  { id: 'carrier', icon: '🛸', name: '母艦',   cost: 1200, noWeapons: ['blade'], desc: '航艦：自身武器傷害 -35%，但開局 3 台僚機、僚機繼承主武器屬性且傷害 ×1.4，「無人僚機」升級每級 +2 台；生命 110', trait: '僚機艦隊',
    stats: { hp: 1.1, speed: 0.95, fire: 0.85, dmg: 0.65 }, apply: p => { p.maxHp = 110; p.hp = 110; p.speedMul *= 0.95; p.fireRate *= 1.18; p.damage *= 0.65; p.flags.droneBoost = true; for (let i = 0; i < 3; i++) p.drones.push({ a: i * TAU / 3, cd: 0.2 * i, x: p.x, y: p.y }); } },
  { id: 'ronin',   icon: '⚔️', name: '劍聖',   cost: 1500, weapons: ['blade'], desc: '只能用光刃：光刃傷害 ×2、每次命中回 2 生命、衝刺帶斬擊、格擋子彈回 1 生命；生命 120；不能裝其他武器', trait: '純近戰',
    stats: { hp: 1.2, speed: 1.1, fire: 1, dmg: 2 }, apply: p => { p.maxHp = 120; p.hp = 120; p.speedMul *= 1.1; p.weapon = 'blade'; p.flags.meleeOnly = true; p.flags.bladeMaster = true; p.flags.dashSlash = true; } },
  { id: 'wraith',  icon: '👻', name: '幽靈',   cost: 1500, desc: '玻璃大砲：生命 60、永遠沒有護盾，但閃現冷卻 0.6 秒、每次擊殺重置閃現；傷害 +15%', trait: '無限閃現',
    stats: { hp: 0.6, speed: 1.05, fire: 1, dmg: 1.15 }, apply: p => { p.maxHp = 60; p.hp = 60; p.speedMul *= 1.05; p.damage *= 1.15; p.blinkCdMax = 0.6; p.r = 12; p.flags.noShield = true; p.flags.killResetBlink = true; } },
  { id: 'engineer', icon: '🔧', name: '工程師', cost: 1800, desc: '衝刺時在原地放下砲塔（最多 2 座、20 秒、繼承主武器）；自身射速 -20%、速度 -10%；生命 120', trait: '砲塔',
    stats: { hp: 1.2, speed: 0.9, fire: 0.8, dmg: 1 }, apply: p => { p.maxHp = 120; p.hp = 120; p.speedMul *= 0.9; p.fireRate *= 1.25; p.flags.turrets = 2; } },
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
  { id: 'blade',   icon: '🗡️', name: '光刃',     cost: 700,  desc: '近戰：朝瞄準方向揮出扇形光刃，傷害 ×3.4 並擊退，能格擋子彈；沒有射程' },
];
/** 武器的攻擊屬性（對照 AFFINITY 用） */
export const WEAPON_ELEMENT = { blaster: 'kinetic', flame: 'fire', frost: 'ice', arc: 'plasma', laser: 'light', blade: 'kinetic' };
/**
 * 同一個升級 / 道具在不同武器上的效果不同（機庫會顯示）。實作散在 game.js 的武器分派段。
 * 鍵：spread 散射道具、rapid 連射道具、pierce 穿甲、bounce 反彈、homing 追蹤、bigshot 巨型彈體
 */
export const WEAPON_MODS = {
  blaster: { spread: '多發子彈扇形射出', rapid: '射速 ×2.2', pierce: '子彈穿透更多敵人', bounce: '子彈撞牆反彈', homing: '子彈轉向追蹤', bigshot: '子彈體積變大' },
  flame:   { spread: '噴射扇形更寬', rapid: '射程 +40%、傷害 +50%', pierce: '燃燒時間更長', bounce: '火焰在地面留下火池', homing: '火舌會彎向最近的敵人', bigshot: '噴射有擊退力' },
  frost:   { spread: '光束變寬', rapid: '凍結速度 ×2', pierce: '凍結的敵人被打碎時對周圍造成傷害', bounce: '光束撞牆反射', homing: '光束自動彎向最近的敵人', bigshot: '凍結時間更長' },
  arc:     { spread: '連鎖目標 +1', rapid: '放電頻率 ×2', pierce: '連鎖跳躍距離 +60%', bounce: '閃電可以跳回打過的目標', homing: '鎖定射程 +50%', bigshot: '每道閃電傷害 +40%' },
  laser:   { spread: '分成多道光束扇形射出', rapid: '傷害 ×1.6', pierce: '持續照射同一目標傷害遞增', bounce: '光束撞牆反射', homing: '光束自動彎向最近的敵人', bigshot: '光束變寬' },
  blade:   { spread: '揮擊扇形更寬', rapid: '揮擊速度 ×2', pierce: '擊退距離加倍', bounce: '每次揮擊放出一道劍氣', homing: '揮擊時會朝最近的敵人短距衝刺', bigshot: '揮擊半徑 +40%' },
};
/**
 * 武器進化：局內湊齊條件（needs 為升級 id → 等級）後，下一次升級選單會出現進化卡；一局只能進化一次。
 * 效果實作在 game.js（p.evolved === id）。
 */
export const EVOLUTIONS = [
  { id: 'railgun', weapon: 'blaster', icon: '🎯', name: '殲星機砲', needs: { pierce: 2, firerate: 2 }, desc: '子彈變成三連發貫穿磁軌彈，每穿過一個目標傷害 +15%' },
  { id: 'inferno', weapon: 'flame',   icon: '🌋', name: '地獄噴發', needs: { explosive: 2 },            desc: '火焰在地面留下熔岩池，燃燒可以疊加到 3 層' },
  { id: 'zero',    weapon: 'frost',   icon: '🧊', name: '絕對零度', needs: { damage: 2, bigshot: 1 },   desc: '照射 1 秒就凍結；凍結中的敵人死亡會碎裂，對周圍造成 60 傷害' },
  { id: 'storm',   weapon: 'arc',     icon: '🌩️', name: '雷暴',     needs: { homing: 2 },               desc: '連鎖目標加倍，而且每秒隨機落雷打最近的敵人' },
  { id: 'solar',   weapon: 'laser',   icon: '☀️', name: '太陽炮',   needs: { damage: 3 },               desc: '光束加寬一倍、持續照射傷害遞增到 2.5 倍，無視 Boss 裝甲' },
  { id: 'dance',   weapon: 'blade',   icon: '🌸', name: '幻影劍舞', needs: { speed: 2, dash: 1 },       desc: '衝刺沿路斬擊，每次揮擊留下一道會自動追擊的殘影' },
];
export function evolutionFor(weapon, upgrades) {
  return EVOLUTIONS.find(e => e.weapon === weapon && Object.entries(e.needs).every(([id, lv]) => (upgrades[id] || 0) >= lv)) || null;
}
export const WEAPON_STATS = { laserDps: 4.2, flameRange: 250, flameCone: 0.4, flameDps: 4.5, frostRange: 520, frostDps: 3.2, frostSlow: 0.4, frostFreezeAfter: 2, arcRange: 380, arcJump: 210, arcTargets: 4, arcDmg: 2.6, arcRate: 2.4,
  bladeRange: 95, bladeArc: 1.1, bladeDmg: 3.4, bladeRate: 2.6, bladeKnock: 380 };
export function weaponById(id) { return WEAPONS.find(w => w.id === id) || WEAPONS[0]; }
export function weaponUnlocked(id, unlocks) { return id === 'blaster' || (unlocks || []).includes('weapon:' + id); }

/** 攻擊屬性（武器）與生物屬性（敵人）。AFFINITY[敵人屬性][武器屬性] = 傷害倍率，沒列的 = 1 */
export const ELEMENTS = {
  neutral: { name: '中性', icon: '◇', color: '#e8f6ff' },
  fire:    { name: '火焰', icon: '🔥', color: '#ff8c42' },
  ice:     { name: '冰霜', icon: '❄️', color: '#b8ffff' },
  toxic:   { name: '劇毒', icon: '☣️', color: '#3ddc84' },
  water:   { name: '深水', icon: '💧', color: '#4cc9f0' },
  plasma:  { name: '電漿', icon: '⚡', color: '#ffd166' },
  void:    { name: '虛空', icon: '🌀', color: '#c77dff' },
};
export const AFFINITY = {
  neutral: {},
  fire:   { ice: 1.6, water: 1.5, fire: 0.5 },
  ice:    { fire: 1.7, plasma: 1.2, ice: 0.5, kinetic: 0.85 },
  toxic:  { fire: 1.5, light: 1.3, toxic: 0.5, kinetic: 0.9 },
  water:  { plasma: 1.8, ice: 1.3, fire: 0.5, water: 0.5 },
  plasma: { kinetic: 1.4, water: 1.3, plasma: 0.5, light: 0.7 },
  void:   { light: 1.6, plasma: 1.2, kinetic: 0.8 },
};
export function affinity(enemyElement, weaponElement) { return (AFFINITY[enemyElement] || {})[weaponElement] ?? 1; }
/**
 * 場地。elements：這個場地的一般敵人會隨機拿到的屬性；unique：專屬敵人種類；hazard 由 game.js 的 updateArena 實作。
 * 全部免費，首頁選擇；多人由房主決定。
 */
export const ARENAS = [
  { id: 'space',   icon: '🌌', name: '深空',     element: 'neutral', elements: ['neutral', 'neutral', 'neutral', 'void'], bg: ['#0b1030', '#03040a'], star: '255,255,255', unique: 'sentinel',
    desc: '標準戰場。虛空族偶爾出沒，雷射對它們特別有效', hazard: '虛空裂隙：隨機開啟，把附近的子彈與敵人吸進去' },
  { id: 'inferno', icon: '🌋', name: '火焰星球', element: 'fire', elements: ['fire', 'fire', 'fire', 'neutral'], bg: ['#3a0a08', '#0a0202'], star: '255,180,120', unique: 'ember',
    desc: '熔岩海。敵人免疫燃燒、怕冰霜與深水', hazard: '熔岩噴發：地面浮出岩漿池（站著會燒）；火柱預警後噴出' },
  { id: 'mercury', icon: '☀️', name: '水星',     element: 'plasma', elements: ['plasma', 'plasma', 'neutral'], bg: ['#2a1e05', '#050300'], star: '255,230,150', unique: 'pulsar',
    desc: '貼著太陽的灼熱行星。電漿生物免疫閃電、怕動能子彈與光刃', hazard: '太陽風暴：整片掃過的日冕帶；重力井會把子彈與機體拉偏' },
  { id: 'venom',   icon: '☣️', name: '毒物星',   element: 'toxic', elements: ['toxic', 'toxic', 'neutral'], bg: ['#0a2a12', '#020a04'], star: '160,255,180', unique: 'spore',
    desc: '孢子與毒霧。毒物生物怕火焰與雷射', hazard: '毒霧潮：毒區自然生成並漂移；孢子雲會遮蔽視線' },
  { id: 'abyss',   icon: '🌊', name: '深海',     element: 'water', elements: ['water', 'water', 'neutral'], bg: ['#041a3a', '#010710'], star: '120,200,255', unique: 'angler',
    desc: '水底戰場：移動有阻力、子彈變慢。深水生物怕閃電', hazard: '洋流：週期性推動所有東西；深海壓力區會把機體往中心壓' },
  { id: 'glacier', icon: '🧊', name: '冰封星',   element: 'ice', elements: ['ice', 'ice', 'neutral'], bg: ['#0a2030', '#020810'], star: '200,240,255', unique: 'frostbite',
    desc: '冰面滑行、煞不住。冰霜生物免疫凍結、怕火焰', hazard: '暴風雪：週期性縮小視野並減速；冰刺從地面竄出' },
];
export function arenaById(id) { return ARENAS.find(a => a.id === id) || ARENAS[0]; }
/** 精英詞綴：精英隨機拿 1 個（第 affixFromWave 波起可能 2 個） */
export const AFFIXES = {
  shielded:  { name: '護盾',   icon: '🛡', desc: '每 6 秒回一層能吸收 40 傷害的護盾' },
  volatile:  { name: '易爆',   icon: '💥', desc: '死亡時炸出 10 顆碎片' },
  vampiric:  { name: '吸血',   icon: '🩸', desc: '打到玩家會回血' },
  hasted:    { name: '疾速',   icon: '💨', desc: '速度 +40%' },
  phasing:   { name: '相位',   icon: '👁', desc: '每 3 秒有 1 秒無法被擊中' },
  splitting: { name: '分裂',   icon: '🐛', desc: '死亡時生出兩隻自爆蟲' },
  regen:     { name: '再生',   icon: '💚', desc: '每秒回 2% 血量' },
  commander: { name: '指揮官', icon: '👑', desc: '附近敵人速度與攻擊 +25%' },
  thorns:    { name: '荊棘',   icon: '🌵', desc: '撞到它或用光刃砍它會被反傷 8' },
};
/**
 * 隨機事件：第 4 波起，每 25–50 秒有機率觸發一個（沒有 Boss 時）。實作在 game.js 的 startEvent / updateEvent。
 */
export const EVENTS = {
  supply:    { name: '補給空投', icon: '📦', desc: '補給箱落下，守住 10 秒可拿 3 個道具與星塵；敵人會衝過去搶', dur: 10 },
  wormhole:  { name: '蟲洞',     icon: '🕳️', desc: '敵人從你周圍的蟲洞跳出來', dur: 0 },
  solarwind: { name: '太陽風',   icon: '🌬️', desc: '10 秒內所有東西被往同一個方向吹', dur: 10 },
  blackhole: { name: '黑洞',     icon: '⚫', desc: '把所有東西往中心吸；靠近中心的敵人被撕碎，玩家也會受傷', dur: 8 },
  rift:      { name: '時空裂縫', icon: '🌈', desc: '另一個場地的生物穿越過來（不同屬性）', dur: 0 },
  duststorm: { name: '星塵風暴', icon: '✨', desc: '撒下一堆星塵碎片，撿到就是這局的額外星塵', dur: 0 },
  hunter:    { name: '追獵者',   icon: '🎯', desc: '一隻帶兩個詞綴的精英獵人鎖定你，擊殺 +400', dur: 0 },
  eclipse:   { name: '日蝕',     icon: '🌑', desc: '8 秒黑暗，只看得到你附近的東西', dur: 8 },
  shower:    { name: '流星雨',   icon: '☄️', desc: '連續流星橫越戰場，打爆有道具', dur: 0 },
};
export const EVENT_FROM_WAVE = 4;
export const EVENT_CD = [25, 50];

export function shipById(id) { return SHIPS.find(s => s.id === id) || SHIPS[0]; }
/** 主動技能：擊殺累積能量（右上 HUD 能量條），滿了按 E / 右鍵 / 觸控鈕施放。第一個免費，其餘用星塵解鎖 */
export const SKILLS = [
  { id: 'swarm',       icon: '🚀', name: '飛彈雨',   cost: 0,   energy: 60,  desc: '射出 30 枚小型追蹤飛彈，每枚 14 傷害，自動鎖定最近的敵人' },
  { id: 'nova',        icon: '☢️', name: '原子彈',   cost: 600, energy: 100, desc: '1.2 秒引爆倒數後全畫面核爆：敵人 260 傷害、Boss 400，清空所有敵彈' },
  { id: 'chrono',      icon: '⏳', name: '時間停止', cost: 700, energy: 80,  desc: '敵人、敵彈與 Boss 凍結 3.5 秒；凍結中的敵人被打死會碎裂傷到周圍' },
  { id: 'aegis',       icon: '🛡️', name: '聖盾脈衝', cost: 500, energy: 70,  desc: '全隊 +2 護盾（沒有護盾的機體 +40 生命），把周圍敵人推開並清掉附近敵彈' },
  { id: 'singularity', icon: '🕳️', name: '奇異點',   cost: 900, energy: 90,  desc: '朝瞄準方向放出黑洞吸 4 秒（不會吸自己人），結束時爆炸造成 150 傷害' },
  { id: 'overdrive',   icon: '⚡', name: '超載',     cost: 400, energy: 60,  desc: '6 秒：連射、傷害 ×1.5、速度 +30%、衝刺無冷卻' },
];
export const skillById = id => SKILLS.find(s => s.id === id) || SKILLS[0];
export function skillUnlocked(id, unlocks) { return id === 'swarm' || (unlocks || []).includes('skill:' + id); }
export const ENERGY = { max: 100, perKill: 5, perElite: 8, perBoss: 30, passive: 0.8 };
/** 機體與武器相容：劍聖只能光刃；母艦靠僚機作戰，不能拿光刃 */
export function weaponAllowed(shipId, weaponId) {
  const s = SHIPS.find(x => x.id === shipId);
  if (!s) return true;
  if (s.weapons) return s.weapons.includes(weaponId);
  if (s.noWeapons) return !s.noWeapons.includes(weaponId);
  return true;
}
export function defaultWeaponFor(shipId) { const s = SHIPS.find(x => x.id === shipId); return s && s.weapons ? s.weapons[0] : 'blaster'; }
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
