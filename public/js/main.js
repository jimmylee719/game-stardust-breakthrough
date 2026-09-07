// 客戶端進入點：組裝世界、渲染、輸入、特效，跑主迴圈。
// 兩種模式：
//   solo   — 本機直接跑 game.js 的 update()
//   online — 連到伺服器房間；伺服器跑 update()，這裡送輸入、收快照插值、播放 fx 事件
import { createWorld, addPlayer, startRun, update, chooseUpgrade, togglePause } from './game.js';
import { createRenderer } from './render.js';
import { attachInput, buildInput, mouse } from './input.js';
import { createFx, vfx, resetEffects, updateEffects, decayEffects } from './effects.js';
import { ensureAudio, toggleMute, isMuted } from './audio.js';
import { connect, playEvents } from './net.js';
import { sanitizeName, NAME_MAX_LEN } from '../../shared/constants.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const menuEl = $('menu'), lobbyEl = $('lobby');
const nameInput = $('name'), codeInput = $('code');
const errEl = $('err'), bestEl = $('best');

const world = createWorld();
const renderer = createRenderer(canvas, world);
let mode = 'solo';
let net = null;
let myId = 1;
let fx = createFx(myId);
let best = +(localStorage.getItem('stardust_best') || 0);
let uiTime = 0;
let lastInputSent = 0;
const me = () => world.players.find(p => p.id === myId);
const isBoss = location.search.includes('boss'); // ?boss 直接從 Boss 波開始（測試用）

// ---------- 選單 ----------
nameInput.maxLength = NAME_MAX_LEN;
nameInput.value = localStorage.getItem('stardust_name') || '';
codeInput.value = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
function showMenu(msg = '') {
  if (net) { net.close(); net = null; }
  world.scene = 'menu'; world.players.length = 0;
  menuEl.hidden = false; lobbyEl.hidden = true;
  errEl.textContent = msg;
  bestEl.textContent = best > 0 ? `最高分 ${best}` : '';
  setTimeout(() => nameInput.focus(), 0);
}
function takeName() {
  const name = sanitizeName(nameInput.value);
  nameInput.value = name;
  localStorage.setItem('stardust_name', name);
  return name;
}

// 單人
function beginSolo() {
  ensureAudio();
  mode = 'solo'; myId = 1; fx = createFx(myId);
  world.players.length = 0;
  addPlayer(world, { id: myId, name: takeName(), local: true });
  resetEffects();
  startRun(world, { startWave: isBoss ? 4 : 0 });
  menuEl.hidden = true; lobbyEl.hidden = true;
}

// 連線
function beginOnline(code) {
  ensureAudio();
  const name = takeName();
  errEl.textContent = '連線中…';
  net = connect({
    name, code, boss: isBoss,
    onWelcome(m) {
      mode = 'online'; myId = m.id; fx = createFx(myId);
      resetEffects();
      menuEl.hidden = true; lobbyEl.hidden = false;
      $('room-code').textContent = m.code;
      const url = `${location.origin}${location.pathname}?room=${m.code}`;
      $('room-link').textContent = url; $('room-link').href = url;
      history.replaceState(null, '', `?room=${m.code}`);
    },
    onLobby(m) {
      $('lobby-players').innerHTML = m.players.map(p => `<li style="color:${p.color}">${p.id === m.hostId ? '👑 ' : ''}${escapeHtml(p.name)}${p.id === myId ? '（你）' : ''}</li>`).join('');
      const host = m.hostId === myId;
      $('lobby-start').hidden = !host;
      $('lobby-wait').hidden = host;
      $('lobby-start').textContent = m.players.length === 1 ? '單獨出擊（可等朋友加入）' : `全員出擊（${m.players.length} 人）`;
      if (world.scene === 'gameover' || world.scene === 'menu') { lobbyEl.hidden = false; world.scene = 'menu'; }
    },
    onStarted() { resetEffects(); lobbyEl.hidden = true; world.scene = 'play'; },
    onError(msg) { showMenu(msg); },
    onClose() { if (mode === 'online') showMenu('與伺服器的連線已中斷'); },
  });
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

$('solo').addEventListener('click', beginSolo);
$('create').addEventListener('click', () => beginOnline(''));
$('join').addEventListener('click', () => { const c = codeInput.value.trim().toUpperCase(); if (!c) { errEl.textContent = '請輸入房號'; codeInput.focus(); return; } beginOnline(c); });
$('lobby-start').addEventListener('click', () => net?.start());
$('lobby-leave').addEventListener('click', () => { history.replaceState(null, '', location.pathname); showMenu(); });
$('copy-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('room-link').href); $('copy-link').textContent = '已複製！'; setTimeout(() => $('copy-link').textContent = '複製邀請連結', 1500); } catch {} });
for (const el of [nameInput, codeInput]) el.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') { if (el === codeInput && codeInput.value.trim()) $('join').click(); else beginSolo(); }
});

// ---------- 輸入 ----------
attachInput(canvas, renderer.toWorld, {
  onKeyDown(code) {
    if (!menuEl.hidden || !lobbyEl.hidden) return;
    if (code === 'KeyM') toggleMute();
    if (mode === 'solo') {
      if (code === 'KeyP') togglePause(world);
      if (code === 'Escape' && (world.scene === 'gameover' || world.scene === 'pause')) showMenu();
      if (code === 'Enter' && world.scene === 'gameover') beginSolo();
    } else {
      if (code === 'Escape' && world.scene === 'gameover') { history.replaceState(null, '', location.pathname); showMenu(); }
      if (code === 'Enter' && world.scene === 'gameover') net?.start();
    }
    if (world.scene === 'upgrade') {
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[code];
      if (n !== undefined) pickUpgrade(n);
    }
  },
  onMouseDown(button) {
    ensureAudio();
    if (button !== 0 || !menuEl.hidden || !lobbyEl.hidden) return;
    if (world.scene === 'gameover') { if (mode === 'solo') beginSolo(); else net?.start(); return; }
    if (world.scene === 'upgrade') {
      const i = renderer.upgradeCardRects().findIndex(r => mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h);
      if (i >= 0) pickUpgrade(i);
    }
  },
  onBlur() { if (mode === 'solo' && world.scene === 'play') togglePause(world); },
});
function pickUpgrade(i) {
  if (mode === 'solo') chooseUpgrade(world, myId, i, fx);
  else net?.chooseUpgrade(i);
}

// ---------- 主迴圈 ----------
window.addEventListener('resize', renderer.resize);
renderer.resize();
let last = performance.now();
function loop(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000); last = now;
  uiTime += rawDt;
  const p = me();

  if (mode === 'online' && net) {
    // 送輸入（約 30Hz）
    if (p && !p.dead && world.scene === 'play' && now - lastInputSent > 1000 / 30) { net.sendInput(buildInput(p)); lastInputSent = now; }
    const prevScene = world.scene;
    const events = net.applyTo(world, now);
    playEvents(events, fx, myId);
    if (prevScene !== 'gameover' && world.scene === 'gameover' && world.score > best) { best = world.score; localStorage.setItem('stardust_best', String(best)); }
    updateEffects(rawDt);
    renderer.updateStars(rawDt, me());
  } else if (world.scene === 'play') {
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
    updateEffects(rawDt);
    renderer.updateStars(rawDt, null);
  }
  decayEffects(rawDt);
  renderer.draw({ time: uiTime, mouse, me: me(), best, muted: isMuted(), online: mode === 'online' });
  requestAnimationFrame(loop);
}
showMenu();
if (codeInput.value) $('join').click(); // 用邀請連結進來：自動加入
requestAnimationFrame(loop);

// 除錯 / 自動測試用
window.__dbg = () => ({ world, vfx, me: me(), mode, net });
