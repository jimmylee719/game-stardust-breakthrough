// 探索任務的地圖：用種子決定性生成，伺服器與每個客戶端各自算出同一張圖（快照只送種子）。
// 地形是圓形障礙（小行星 / 熔岩石 / 冰晶 / 珊瑚 / 孢子囊），玩家、敵人、子彈都會被擋；三個中繼站啟動後出現撤離點。
import { TAU } from './math.js';

export const MISSION = {
  W: 4800, H: 2700,          // 3 × 3 個畫面大
  objectives: 3,             // 要啟動的中繼站數
  activate: 6,               // 站在中繼站範圍內累計秒數
  extract: 8,                // 全員站在撤離點的秒數
  waveEvery: 45,             // 每 45 秒威脅等級 +1（沿用波次難度曲線與每 2 波升級）
  patrolCd: [7, 11],         // 巡邏隊生成間隔
  alarmMul: 2.6,             // 啟動中 / 剛啟動完：生成頻率倍率
  spawnRing: [950, 1300],    // 敵人在玩家視野外這個距離帶生成
  bonus: 3000, reward: 1.3,  // 撤離成功：分數加成、星塵倍率
  objScore: 800,
};

/** 各場地的地形種類（render 依 kind 配色） */
export const TERRAIN = { space: 'rock', inferno: 'lava', mercury: 'metal', venom: 'spore', abyss: 'coral', glacier: 'ice' };

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * 生成地圖。回傳 { W, H, start, obstacles: [{id,x,y,r,kind,pts}], objectives: [{x,y,r}], extract: {x,y} }
 * pts：多邊形頂點半徑比例（畫鋸齒岩石用），同一種子永遠相同。
 */
export function genMap(seed, arena = 'space') {
  const r = mulberry(seed || 1), W = MISSION.W, H = MISSION.H;
  const rand = (a, b) => a + r() * (b - a);
  const kind = TERRAIN[arena] || 'rock';
  const start = { x: W / 2, y: H / 2 };
  const obstacles = [];
  const clearOf = (x, y, rr, list, gap) => list.every(o => Math.hypot(o.x - x, o.y - y) > o.r + rr + gap);
  // 中繼站：離起點 ≥ 1100、彼此 ≥ 900
  const objectives = [];
  let guard = 0;
  while (objectives.length < MISSION.objectives && guard++ < 400) {
    const x = rand(260, W - 260), y = rand(260, H - 260);
    if (Math.hypot(x - start.x, y - start.y) < 1100) continue;
    if (!objectives.every(o => Math.hypot(o.x - x, o.y - y) > 900)) continue;
    objectives.push({ x, y, r: 120 });
  }
  // 撤離點：離起點最遠的角落方向
  const corners = [[300, 300], [W - 300, 300], [300, H - 300], [W - 300, H - 300]];
  let extract = null, best = -1;
  for (const [cx, cy] of corners) { const d = Math.min(...objectives.map(o => Math.hypot(o.x - cx, o.y - cy)), Math.hypot(start.x - cx, start.y - cy)); if (d > best) { best = d; extract = { x: cx, y: cy }; } }
  // 障礙：約 70 顆，避開起點、中繼站、撤離點
  const keep = [{ x: start.x, y: start.y, r: 260 }, ...objectives.map(o => ({ x: o.x, y: o.y, r: 220 })), { x: extract.x, y: extract.y, r: 260 }];
  guard = 0;
  while (obstacles.length < 70 && guard++ < 3000) {
    const rr = rand(45, 150), x = rand(rr + 20, W - rr - 20), y = rand(rr + 20, H - rr - 20);
    if (!clearOf(x, y, rr, keep, 0) || !clearOf(x, y, rr, obstacles, 70)) continue;
    const n = 7 + Math.floor(r() * 5), pts = [];
    for (let k = 0; k < n; k++) pts.push(rand(0.72, 1.05));
    obstacles.push({ id: obstacles.length + 1, x: Math.round(x), y: Math.round(y), r: Math.round(rr), kind, pts, rot: rand(0, TAU) });
  }
  return { W, H, start, obstacles, objectives, extract };
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
