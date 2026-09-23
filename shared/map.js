// 任務地圖：用種子決定性生成，伺服器與每個客戶端各自算出同一張圖（快照只送種子）。
// 所有遊玩都是任務（沒有固定框框的競技場）：大地圖 + 地形 + 目標 + 撤離。
import { TAU } from './math.js';

export const MISSION = {
  W: 4800, H: 2700,          // 3 × 3 個畫面大
  objectives: 3,             // 中繼站 / 蟲巢的數量
  activate: 6,               // 站在中繼站範圍內累計秒數
  extract: 8,                // 全員站在撤離點的秒數
  waveEvery: 45,             // 每 45 秒威脅等級 +1（沿用波次難度曲線與每 2 級升級）
  patrolCd: [7, 11],         // 巡邏隊生成間隔
  alarmMul: 2.6,             // 啟動中 / 剛啟動完：生成頻率倍率
  spawnRing: [950, 1300],    // 敵人在玩家視野外這個距離帶生成
  bonus: 3000, reward: 1.3,  // 撤離成功：分數加成、星塵倍率
  objScore: 800,
  killNeed: [40, 15],        // 殲滅任務：基礎 + 每位玩家
  caches: 8,                 // 地圖上的星塵礦點（撿到就是這局的額外星塵）
  bossSite: 800,             // 靠近 Boss 據點多近會觸發
  reinforce: [2, 1],         // 增援次數（全隊共用）：基礎 + 每位玩家；陣亡後幾秒空降回來
  reinforceT: 5,
};

/** 任務類型（絕地戰兵式：每次出擊選一種或隨機） */
export const MISSION_TYPES = {
  relay:       { icon: '📡', name: '中繼站啟動', desc: '站在三座中繼站各 6 秒把它們啟動，啟動中敵人會加倍湧來' },
  exterminate: { icon: '💀', name: '殲滅',       desc: '擊殺指定數量的敵人（敵人會不斷增援），達標後撤離' },
  nests:       { icon: '🕳️', name: '拆除蟲巢',   desc: '找到三座會不斷生敵的蟲巢並摧毀它們' },
  boss:        { icon: '👑', name: 'Boss 據點',   desc: '深入 Boss 盤據的據點，擊破後撤離；Boss 挑戰會一次出好幾隻' },
};
export const MISSION_TYPE_IDS = Object.keys(MISSION_TYPES);
export function pickMissionType(seed) { return MISSION_TYPE_IDS[(seed >>> 0) % MISSION_TYPE_IDS.length]; }

/** 各場地的地形種類（render 依 kind 配色） */
export const TERRAIN = { space: 'rock', inferno: 'lava', mercury: 'metal', venom: 'spore', abyss: 'coral', glacier: 'ice' };

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * 生成地圖。回傳 { W, H, type, start, obstacles: [{id,x,y,r,kind,pts,rot}], sites: [{x,y,r}], extract: {x,y}, caches: [{x,y}] }
 * sites：依任務類型是中繼站 / 蟲巢（3 座）或 Boss 據點（1 座）；殲滅任務沒有站點。
 * pts：多邊形頂點半徑比例（畫鋸齒岩石用），同一種子永遠相同。
 */
export function genMap(seed, arena = 'space', type = 'relay') {
  const r = mulberry(seed || 1), W = MISSION.W, H = MISSION.H;
  const rand = (a, b) => a + r() * (b - a);
  const kind = TERRAIN[arena] || 'rock';
  const start = { x: W / 2, y: H / 2 };
  const clearOf = (x, y, rr, list, gap) => list.every(o => Math.hypot(o.x - x, o.y - y) > o.r + rr + gap);
  // 站點：離起點夠遠、彼此夠遠
  const nSites = type === 'boss' ? 1 : type === 'exterminate' ? 0 : MISSION.objectives;
  const minStart = type === 'boss' ? 1500 : 1100;
  const sites = [];
  let guard = 0;
  while (sites.length < nSites && guard++ < 600) {
    const x = rand(300, W - 300), y = rand(300, H - 300);
    if (Math.hypot(x - start.x, y - start.y) < minStart) continue;
    if (!sites.every(o => Math.hypot(o.x - x, o.y - y) > 900)) continue;
    sites.push({ x: Math.round(x), y: Math.round(y), r: type === 'nests' ? 150 : 120 });
  }
  // 撤離點：離起點與站點都最遠的角落
  const corners = [[300, 300], [W - 300, 300], [300, H - 300], [W - 300, H - 300]];
  let extract = null, best = -1;
  for (const [cx, cy] of corners) { const d = Math.min(...sites.map(o => Math.hypot(o.x - cx, o.y - cy)), Math.hypot(start.x - cx, start.y - cy)); if (d > best) { best = d; extract = { x: cx, y: cy }; } }
  // 障礙：約 70 顆，避開起點、站點、撤離點
  const keep = [{ x: start.x, y: start.y, r: 260 }, ...sites.map(o => ({ x: o.x, y: o.y, r: type === 'boss' ? 420 : 220 })), { x: extract.x, y: extract.y, r: 260 }];
  const obstacles = [];
  guard = 0;
  while (obstacles.length < 70 && guard++ < 3000) {
    const rr = rand(45, 150), x = rand(rr + 20, W - rr - 20), y = rand(rr + 20, H - rr - 20);
    if (!clearOf(x, y, rr, keep, 0) || !clearOf(x, y, rr, obstacles, 70)) continue;
    const n = 7 + Math.floor(r() * 5), pts = [];
    for (let k = 0; k < n; k++) pts.push(rand(0.72, 1.05));
    obstacles.push({ id: obstacles.length + 1, x: Math.round(x), y: Math.round(y), r: Math.round(rr), kind, pts, rot: rand(0, TAU) });
  }
  // 星塵礦點：散在地圖各處、不在地形裡、離起點一段距離
  const caches = [];
  guard = 0;
  while (caches.length < MISSION.caches && guard++ < 600) {
    const x = rand(120, W - 120), y = rand(120, H - 120);
    if (Math.hypot(x - start.x, y - start.y) < 500 || obstacleAt(obstacles, x, y, 40) || !caches.every(c => Math.hypot(c.x - x, c.y - y) > 400)) continue;
    caches.push({ x: Math.round(x), y: Math.round(y) });
  }
  return { W, H, type, start, obstacles, sites, extract, caches };
}

/** 把圓形物體推出所有障礙（純函式，只改 o.x / o.y / o.vx / o.vy）。回傳是否碰到。 */
export function resolveObstacles(obstacles, o, r) {
  if (!obstacles || !obstacles.length) return false;
  let hit = false;
  for (const ob of obstacles) {
    const dx = o.x - ob.x, dy = o.y - ob.y, min = ob.r + r;
    if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
    const d = Math.hypot(dx, dy);
    if (d >= min) continue;
    const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;   // 正中央：往右推
    o.x = ob.x + nx * min; o.y = ob.y + ny * min;
    if (o.vx !== undefined) { const vn = o.vx * nx + o.vy * ny; if (vn < 0) { o.vx -= vn * nx; o.vy -= vn * ny; } }
    hit = true;
  }
  return hit;
}
/** 點是否在任何障礙裡（子彈用）；回傳撞到的障礙或 null */
export function obstacleAt(obstacles, x, y, r = 0) {
  if (!obstacles || !obstacles.length) return null;
  for (const ob of obstacles) { const m = ob.r + r; if (Math.abs(x - ob.x) < m && Math.abs(y - ob.y) < m && (x - ob.x) ** 2 + (y - ob.y) ** 2 < m * m) return ob; }
  return null;
}
