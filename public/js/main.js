// 客戶端進入點：組裝世界、渲染、輸入、特效，跑主迴圈。
// 單機模式：本機直接跑 game.js 的 update()。多人模式（下一步）會改成由伺服器跑 update，這裡只收快照。
import { createWorld, addPlayer, startRun, update, chooseUpgrade, togglePause } from './game.js';
import { createRenderer } from './render.js';
import { attachInput, buildInput, mouse } from './input.js';
import { createFx, vfx, resetEffects, updateEffects, decayEffects } from './effects.js';
import { ensureAudio, toggleMute, isMuted } from './audio.js';
import { sanitizeName, NAME_MAX_LEN } from '../../shared/constants.js';

const canvas = document.getElementById('game');
const menuEl = document.getElementById('menu');
const nameInput = document.getElementById('name');
const startBtn = document.getElementById('start');
const bestEl = document.getElementById('best');

const world = createWorld();
const renderer = createRenderer(canvas, world);
const LOCAL_ID = 1;
const fx = createFx(LOCAL_ID);
let best = +(localStorage.getItem('stardust_best') || 0);
let uiTime = 0;

// ---------- 名字與選單 ----------
nameInput.maxLength = NAME_MAX_LEN;
nameInput.value = localStorage.getItem('stardust_name') || '';
function showMenu() {
  world.scene = 'menu';
  menuEl.hidden = false;
  bestEl.textContent = best > 0 ? `最高分 ${best}` : '';
  setTimeout(() => nameInput.focus(), 0);
}
function beginGame() {
  ensureAudio();
  const name = sanitizeName(nameInput.value);
  nameInput.value = name;
  localStorage.setItem('stardust_name', name);
  world.players.length = 0;
  addPlayer(world, { id: LOCAL_ID, name, local: true });
  resetEffects();
  const startWave = location.search.includes('boss') ? 4 : 0; // ?boss 直接從 Boss 波開始（測試用）
  startRun(world, { startWave });
  menuEl.hidden = true;
}
startBtn.addEventListener('click', beginGame);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') beginGame(); e.stopPropagation(); });

// ---------- 輸入 ----------
const me = () => world.players.find(p => p.id === LOCAL_ID);
attachInput(canvas, renderer.toWorld, {
  onKeyDown(code) {
    if (world.scene === 'menu') return;
    if (code === 'KeyP') togglePause(world);
    if (code === 'KeyM') toggleMute();
    if (code === 'Escape' && (world.scene === 'gameover' || world.scene === 'pause')) showMenu();
    if (code === 'Enter' && world.scene === 'gameover') beginGame();
    if (world.scene === 'upgrade') {
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[code];
      if (n !== undefined) chooseUpgrade(world, LOCAL_ID, n, fx);
    }
  },
  onMouseDown(button) {
    ensureAudio();
    if (button !== 0) return;
    if (world.scene === 'gameover') { beginGame(); return; }
    if (world.scene === 'upgrade') {
      const i = renderer.upgradeCardRects().findIndex(r => mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h);
      if (i >= 0) chooseUpgrade(world, LOCAL_ID, i, fx);
    }
  },
  onBlur() { if (world.scene === 'play') togglePause(world); },
});

// ---------- 主迴圈 ----------
window.addEventListener('resize', renderer.resize);
renderer.resize();
let last = performance.now();
function loop(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000); last = now;
  uiTime += rawDt;
  if (world.scene === 'play') {
    const p = me();
    if (p) p.input = buildInput(p);
    if (vfx.hitStop > 0) vfx.hitStop -= rawDt;
    else {
      const dt = vfx.slowmo > 0 ? rawDt * 0.35 : rawDt;
      const prevScene = world.scene;
      update(world, dt, fx);
      updateEffects(dt);
      renderer.updateStars(dt, p);
      if (prevScene !== 'gameover' && world.scene === 'gameover' && world.score > best) { best = world.score; localStorage.setItem('stardust_best', String(best)); }
    }
  } else {
    // 非遊戲場景：粒子繼續飄、震動繼續衰減，但世界凍結
    updateEffects(rawDt);
    renderer.updateStars(rawDt, null);
  }
  decayEffects(rawDt);
  renderer.draw({ time: uiTime, mouse, me: me(), best, muted: isMuted() });
  requestAnimationFrame(loop);
}
showMenu();
requestAnimationFrame(loop);

// 除錯 / 自動測試用
window.__dbg = () => ({ world, vfx, me: me() });
