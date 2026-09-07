// 純數學工具：瀏覽器與 Node.js 共用，不依賴任何環境。
export const TAU = Math.PI * 2;

// 可換種子的亂數：每日挑戰用固定種子讓所有人打到同樣的波次組合；平常用 Math.random。
let rng = Math.random;
export const rnd = () => rng();
export const rand = (a, b) => a + rng() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
/** seed 為數字 → 決定性亂數（mulberry32）；null → 回到 Math.random */
export function seedRandom(seed) {
  if (seed === null || seed === undefined) { rng = Math.random; return; }
  let a = seed >>> 0;
  rng = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** 字串 → 32 位元雜湊（FNV-1a），給種子用 */
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
export const lerp = (a, b, t) => a + (b - a) * t;
/** 把角度差正規化到 -PI..PI */
export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}
