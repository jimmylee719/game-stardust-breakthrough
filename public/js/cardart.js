// 機庫卡圖：用遊戲自己的霓虹風格即時畫在 <canvas>（不需要外部圖檔）。
// 機體用戰場上同一個船身輪廓，武器 / 技能畫示意圖；有 AI 圖檔時 main.js 會改用圖檔。
import { skinById } from '../../shared/constants.js';
const TAU = Math.PI * 2;

/** 各機體的船身輪廓（朝 +x）；與 render.js 的 shipPath 同一組資料 */
function shipPath(ctx, ship) {
  ctx.beginPath();
  if (ship === 'wasp') { ctx.moveTo(22, 0); ctx.lineTo(-8, 6); ctx.lineTo(-14, 12); ctx.lineTo(-6, 0); ctx.lineTo(-14, -12); ctx.lineTo(-8, -6); }
  else if (ship === 'ronin') { ctx.moveTo(20, 0); ctx.lineTo(2, 5); ctx.lineTo(-12, 13); ctx.lineTo(-7, 0); ctx.lineTo(-12, -13); ctx.lineTo(2, -5); ctx.closePath(); ctx.moveTo(6, 0); ctx.lineTo(26, 0); }
  else if (ship === 'wraith') { ctx.moveTo(20, 0); ctx.lineTo(-4, 4); ctx.lineTo(-16, 10); ctx.lineTo(-10, 0); ctx.lineTo(-16, -10); ctx.lineTo(-4, -4); }
  else if (ship === 'engineer') { ctx.moveTo(14, 0); ctx.lineTo(6, 10); ctx.lineTo(-10, 10); ctx.lineTo(-14, 4); ctx.lineTo(-14, -4); ctx.lineTo(-10, -10); ctx.lineTo(6, -10); ctx.closePath(); ctx.moveTo(-2, -14); ctx.lineTo(-2, 14); }
  else if (ship === 'bastion') { ctx.moveTo(16, 0); ctx.lineTo(8, 12); ctx.lineTo(-12, 14); ctx.lineTo(-8, 0); ctx.lineTo(-12, -14); ctx.lineTo(8, -12); }
  else if (ship === 'carrier') { ctx.moveTo(20, 0); ctx.lineTo(4, 8); ctx.lineTo(-14, 8); ctx.lineTo(-10, 0); ctx.lineTo(-14, -8); ctx.lineTo(4, -8); ctx.closePath(); ctx.moveTo(-2, 14); ctx.lineTo(-12, 14); ctx.lineTo(-8, 9); ctx.moveTo(-2, -14); ctx.lineTo(-12, -14); ctx.lineTo(-8, -9); }
  else { ctx.moveTo(18, 0); ctx.lineTo(-10, 11); ctx.lineTo(-5, 0); ctx.lineTo(-10, -11); }
  ctx.closePath();
}
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function backdrop(ctx, S, seed, tint) {
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, tint); g.addColorStop(1, '#04061a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const r = seeded(seed);
  for (let i = 0; i < 40; i++) { ctx.globalAlpha = 0.25 + r() * 0.6; ctx.fillStyle = '#fff'; const z = r(); ctx.beginPath(); ctx.arc(r() * S, r() * S, 0.6 + z * 1.4, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
}
function neon(ctx, color, blur = 22) { ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; }

export function drawShipCard(canvas, shipId, skinId = 'classic', color = '#4cc9f0') {
  const S = canvas.width, ctx = canvas.getContext('2d'); if (!ctx) return;
  const sk = skinById(skinId);
  backdrop(ctx, S, shipId.length * 977 + 13, '#0b1030');
  ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(-Math.PI / 2); ctx.scale(S / 72, S / 72);
  // 推進火焰
  ctx.fillStyle = 'rgba(255,170,60,.85)'; ctx.shadowColor = '#ff8c42'; ctx.shadowBlur = 14; ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(-30, 0); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
  // 機體特徵
  if (shipId === 'bastion') { neon(ctx, '#4cc9f0', 14); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 30, -1.05, 1.05); ctx.stroke(); }
  if (shipId === 'carrier') { ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 10; for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + 0.4; ctx.save(); ctx.translate(Math.cos(a) * 30, Math.sin(a) * 30); ctx.rotate(a + Math.PI / 2); ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 4); ctx.lineTo(-2, 0); ctx.lineTo(-4, -4); ctx.closePath(); ctx.fill(); ctx.restore(); } }
  if (shipId === 'ronin') { neon(ctx, '#ffffff', 18); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(8, 0, 30, -0.9, 0.9); ctx.stroke(); }
  if (shipId === 'wraith') { ctx.globalAlpha = 0.35; ctx.strokeStyle = '#c77dff'; ctx.shadowColor = '#c77dff'; ctx.shadowBlur = 16; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.save(); ctx.translate(-16, 0); shipPath(ctx, shipId); ctx.stroke(); ctx.restore(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
  if (shipId === 'wasp') { ctx.globalAlpha = 0.5; neon(ctx, '#ffd166', 12); ctx.beginPath(); ctx.arc(-34, 0, 9, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
  if (shipId === 'engineer') { neon(ctx, '#ffd166', 10); for (const y of [-26, 26]) { ctx.beginPath(); ctx.arc(-6, y, 5, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-6, y); ctx.lineTo(6, y); ctx.stroke(); } }
  if (shipId === 'falcon') { ctx.globalAlpha = 0.35; neon(ctx, '#90f1a8', 10); ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
  // 船身
  ctx.fillStyle = sk.hull; ctx.strokeStyle = sk.stroke || color; ctx.shadowColor = sk.glow || color; ctx.shadowBlur = 22; ctx.lineWidth = 2.2; if (sk.dash) ctx.setLineDash([5, 4]);
  shipPath(ctx, shipId); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = color; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(4, 0, 3.5, 0, TAU); ctx.fill();
  ctx.restore();
}

const WCOL = { blaster: '#4cc9f0', flame: '#ff8c42', frost: '#b8ffff', arc: '#c77dff', laser: '#ffffff', blade: '#ffd166' };
export function drawWeaponCard(canvas, id) {
  const S = canvas.width, ctx = canvas.getContext('2d'); if (!ctx) return;
  const c = WCOL[id] || '#4cc9f0';
  backdrop(ctx, S, id.length * 313 + 7, '#0a0f2a');
  ctx.save(); ctx.translate(S * 0.18, S / 2); ctx.scale(S / 100, S / 100);
  neon(ctx, c);
  if (id === 'blaster') { for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(6, i * 12); ctx.lineTo(54 - Math.abs(i) * 8, i * 12); ctx.stroke(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(56 - Math.abs(i) * 8, i * 12, 3.5, 0, TAU); ctx.fill(); } }
  else if (id === 'flame') { const g = ctx.createLinearGradient(0, 0, 60, 0); g.addColorStop(0, 'rgba(255,209,102,.95)'); g.addColorStop(1, 'rgba(255,60,30,0)'); ctx.fillStyle = g; ctx.shadowBlur = 24; ctx.beginPath(); ctx.moveTo(4, 0); ctx.quadraticCurveTo(30, -26, 62, -16); ctx.quadraticCurveTo(48, 0, 62, 16); ctx.quadraticCurveTo(30, 26, 4, 0); ctx.fill(); ctx.fillStyle = '#ffd166'; for (let i = 0; i < 7; i++) { const r = seeded(i + 9)(); ctx.beginPath(); ctx.arc(14 + i * 7, Math.sin(i * 1.7) * 9, 1.5 + r * 2, 0, TAU); ctx.fill(); } }
  else if (id === 'frost') { ctx.lineWidth = 7; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(62, 0); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(62, 0); ctx.stroke(); for (let i = 0; i < 4; i++) { const x = 18 + i * 12; for (let k = 0; k < 6; k++) { const a = k * TAU / 6 + i; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + Math.cos(a) * 6, Math.sin(a) * 6); ctx.stroke(); } } }
  else if (id === 'arc') { const r = seeded(21); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(6, 0); let x = 6, y = 0; while (x < 60) { x += 6 + r() * 6; y = (r() - 0.5) * 26; ctx.lineTo(x, y); } ctx.stroke(); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(30, 4); ctx.lineTo(40, 18); ctx.lineTo(50, 14); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill(); }
  else if (id === 'laser') { ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(184,255,255,.35)'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(66, 0); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(66, 0); ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#b8ffff'; ctx.beginPath(); ctx.moveTo(60, -8); ctx.lineTo(66, 0); ctx.lineTo(60, 8); ctx.stroke(); }
  else if (id === 'blade') { ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(10, 0, 40, -1.1, 1.1); ctx.stroke(); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(10, 0, 30, -0.9, 0.9); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(0, 5); ctx.lineTo(2, 0); ctx.lineTo(0, -5); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

const SCOL = { swarm: '#ffd166', nova: '#ff3860', chrono: '#b8ffff', aegis: '#4cc9f0', singularity: '#c77dff', overdrive: '#ffd166' };
export function drawSkillCard(canvas, id) {
  const S = canvas.width, ctx = canvas.getContext('2d'); if (!ctx) return;
  const c = SCOL[id] || '#ffd166';
  backdrop(ctx, S, id.length * 517 + 3, '#0c0a24');
  ctx.save(); ctx.translate(S / 2, S / 2); ctx.scale(S / 100, S / 100);
  neon(ctx, c);
  if (id === 'swarm') { const r = seeded(5); for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (r() - 0.5) * 2.2, L = 22 + r() * 22; ctx.globalAlpha = 0.5 + r() * 0.5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(Math.cos(a) * L, Math.sin(a) * L, 2.5, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; }
  else if (id === 'nova') { for (let i = 1; i <= 4; i++) { ctx.globalAlpha = 1 - i * 0.2; ctx.lineWidth = 4 - i * 0.6; ctx.beginPath(); ctx.arc(0, 0, i * 11, 0, TAU); ctx.stroke(); } ctx.globalAlpha = 1; const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 14); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,56,96,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill(); }
  else if (id === 'chrono') { ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.stroke(); for (let i = 0; i < 12; i++) { const a = i * TAU / 12; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 28, Math.sin(a) * 28); ctx.lineTo(Math.cos(a) * 34, Math.sin(a) * 34); ctx.stroke(); } ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -22); ctx.moveTo(0, 0); ctx.lineTo(16, 8); ctx.stroke(); ctx.globalAlpha = 0.4; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 44, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
  else if (id === 'aegis') { for (let i = 0; i < 3; i++) { ctx.globalAlpha = 1 - i * 0.3; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 18 + i * 10, -2.2, 2.2); ctx.stroke(); } ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(10, -6); ctx.lineTo(10, 4); ctx.lineTo(0, 12); ctx.lineTo(-10, 4); ctx.lineTo(-10, -6); ctx.closePath(); ctx.fill(); }
  else if (id === 'singularity') { for (let i = 0; i < 5; i++) { ctx.globalAlpha = 0.3 + i * 0.15; ctx.lineWidth = 2; const rr = 10 + i * 7, a0 = i * 1.3; ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + 2.4); ctx.stroke(); } ctx.globalAlpha = 1; const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 12); g.addColorStop(0, '#000'); g.addColorStop(0.7, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.shadowBlur = 0; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill(); }
  else if (id === 'overdrive') { ctx.fillStyle = c; ctx.shadowBlur = 24; ctx.beginPath(); ctx.moveTo(6, -34); ctx.lineTo(-14, 4); ctx.lineTo(0, 4); ctx.lineTo(-6, 34); ctx.lineTo(16, -6); ctx.lineTo(2, -6); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 0.5; ctx.lineWidth = 2; for (const y of [-20, 0, 20]) { ctx.beginPath(); ctx.moveTo(-44, y); ctx.lineTo(-24, y); ctx.stroke(); } ctx.globalAlpha = 1; }
  ctx.restore();
}
/** 把容器裡所有 <canvas data-art="kind:id"> 畫好 */
export function paintArt(container, skin = 'classic', color = '#4cc9f0') {
  for (const cv of container.querySelectorAll('canvas[data-art]')) {
    const [kind, id] = cv.dataset.art.split(':');
    if (kind === 'ship') drawShipCard(cv, id, skin, color); else if (kind === 'weapon') drawWeaponCard(cv, id); else if (kind === 'skill') drawSkillCard(cv, id);
  }
}
