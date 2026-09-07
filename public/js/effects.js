// 客戶端視覺回饋：粒子、浮動文字、震動、定格、色差等。
// 實作 game.js 定義的 fx 介面；多人版時，這些會由伺服器事件觸發，而不是邏輯直接呼叫。
import { rand, TAU } from '../../shared/math.js';
import { NULL_FX } from './game.js';
import { sfx as SFX, beep, noise } from './audio.js';

export const vfx = { shake: 0, flash: 0, slowmo: 0, hitStop: 0, hitStopCd: 0, aberr: 0, crossPunch: 0, crossRecoil: 0, zoom: 0 };
export const particles = [];
export const floatTexts = [];

export function resetEffects() {
  particles.length = 0; floatTexts.length = 0;
  for (const k of Object.keys(vfx)) vfx[k] = 0;
}

export function burst(x, y, color, n = 12, speed = 180, life = 0.6, size = 3) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(speed * 0.3, speed);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life, color, size: rand(size * 0.5, size) });
  }
}
export function burstDir(x, y, color, n, a, spread = 0.7, speed = 260, life = 0.35, size = 2.5) {
  for (let i = 0; i < n; i++) {
    const aa = a + rand(-spread, spread), s = rand(speed * 0.4, speed);
    particles.push({ x, y, vx: Math.cos(aa) * s, vy: Math.sin(aa) * s, life, maxLife: life, color, size: rand(size * 0.5, size), streak: true });
  }
}
export function ring(x, y, color, r0 = 6, r1 = 60, life = 0.3, width = 3) {
  particles.push({ x, y, vx: 0, vy: 0, life, maxLife: life, color, size: 0, ring: true, r0, r1, width });
}
export function ghost(x, y, size, color, life = 0.3) {
  particles.push({ x, y, vx: 0, vy: 0, life, maxLife: life, color, size, ghost: true });
}
export function muzzle(x, y, a) {
  ghost(x, y, 9, '#fff', 0.05);
  burstDir(x, y, '#ffe9a8', 3, a, 0.35, 220, 0.15, 2);
}
export function floatText(x, y, text, color = '#fff', size = 16, life = 0.9) {
  floatTexts.push({ x, y, text, color, size, life, maxLife: life });
}
export function shake(v) { vfx.shake = Math.min(vfx.shake + v, 24); }
export function hitStop(sec, minor = false) {
  if (minor) { if (vfx.hitStopCd > 0) return; vfx.hitStopCd = 0.15; }
  vfx.hitStop = Math.max(vfx.hitStop, sec);
}
export function aberrate(v) { vfx.aberr = Math.min(1, vfx.aberr + v); }

/** 建立給 game.js 用的 fx 物件。localPlayerId 決定哪些「只對自己」的效果會觸發。 */
export function createFx(localPlayerId) {
  const fx = {
    burst, burstDir, ring, muzzle, ghost, text: floatText,
    shake, hitStop, aberrate,
    flash: v => { vfx.flash = Math.max(vfx.flash, v); },
    slowmo: s => { vfx.slowmo = Math.max(vfx.slowmo, s); },
    zoom: v => { vfx.zoom = Math.max(vfx.zoom, v); },
    crossPunch: () => { vfx.crossPunch = 1; },
    crossRecoil: () => { vfx.crossRecoil = 1; },
    sfx: name => { const f = SFX[name]; if (f) f(); },
    beep, noise,
    local: p => (p && p.id === localPlayerId ? fx : NULL_FX),
  };
  return fx;
}

/** 隨遊戲時間更新粒子與文字（受慢動作影響） */
export function updateEffects(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.life -= dt;
    if (q.life <= 0) { particles.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.vx *= Math.pow(0.05, dt); q.vy *= Math.pow(0.05, dt);
  }
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const f = floatTexts[i]; f.life -= dt; f.y -= 30 * dt;
    if (f.life <= 0) floatTexts.splice(i, 1);
  }
  vfx.flash = Math.max(0, vfx.flash - dt * 3);
}
/** 隨真實時間衰減（不受慢動作與定格影響） */
export function decayEffects(rawDt) {
  // 震動與慢動作以真實時間計，避免慢動作把自己拉長（炸彈約 0.6 秒收掉）
  vfx.shake *= Math.pow(0.004, rawDt);
  vfx.slowmo = Math.max(0, vfx.slowmo - rawDt);
  vfx.aberr = Math.max(0, vfx.aberr - rawDt * 4);
  vfx.hitStopCd = Math.max(0, vfx.hitStopCd - rawDt);
  vfx.crossPunch = Math.max(0, vfx.crossPunch - rawDt * 5);
  vfx.crossRecoil = Math.max(0, vfx.crossRecoil - rawDt * 12);
  vfx.zoom = Math.max(0, vfx.zoom - rawDt * 6);
}
