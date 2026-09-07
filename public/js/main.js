// 客戶端進入點：組裝世界、渲染、輸入、特效，跑主迴圈。
// 兩種模式：
//   solo   — 本機直接跑 game.js 的 update()
//   online — 連到伺服器房間；伺服器跑 update()，這裡送輸入、收快照插值、播放 fx 事件、預測自己的機體
import { createWorld, addPlayer, startRun, update, chooseUpgrade, togglePause } from './game.js';
import { createRenderer } from './render.js';
import { attachInput, buildInput, mouse } from './input.js';
import { createFx, vfx, resetEffects, updateEffects, decayEffects } from './effects.js';
import { ensureAudio, toggleMute, isMuted } from './audio.js';
import { connect, playEvents } from './net.js';
import { createPredictor } from './predict.js';
import { sanitizeName, NAME_MAX_LEN } from '../../shared/constants.js';
import './themes.js';   // 套用霓虹主題（唯一風格）
import { ensureAccount, accountCredentials, submitSoloRun, fetchLeaderboard, fetchMe, getAccount } from './account.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const menuEl = $('menu'), lobbyEl = $('lobby'), pauseEl = $('pause'), toastEl = $('toast'), lbEl = $('leaderboard');
const nameInput = $('name'), codeInput = $('code');
const errEl = $('err'), bestEl = $('best');

const world = createWorld();
const renderer = createRenderer(canvas, world);
let mode = 'solo';
let net = null;
let myId = 1;
let hostId = null;
let fx = createFx(myId);
let best = +(localStorage.getItem('stardust_best') || 0);
let uiTime = 0;
const predictor = createPredictor(world);
let lastSnapSeen = -1;
let toastTimer = 0;
let lastResult = null;   // 結算畫面用：{ rank, mode }
const me = () => world.players.find(p => p.id === myId);
const overlayOpen = () => !menuEl.hidden || !lobbyEl.hidden || !pauseEl.hidden || !lbEl.hidden;

// ---------- 小工具 ----------
function toast(msg, ms = 2500) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms); }
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function takeName() {
  const name = sanitizeName(nameInput.value);
  nameInput.value = name;
  localStorage.setItem('stardust_name', name);
  ensureAccount(name);   // 背景同步匿名帳號（首次自動註冊）
  return name;
}

// ---------- 選單 ----------
nameInput.maxLength = NAME_MAX_LEN;
nameInput.value = localStorage.getItem('stardust_name') || '';
codeInput.value = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
function showMenu(msg = '') {
  if (net) { net.close(); net = null; }
  mode = 'solo';
  world.scene = 'menu'; world.players.length = 0;
  menuEl.hidden = false; lobbyEl.hidden = true; pauseEl.hidden = true;
  errEl.textContent = msg;
  bestEl.textContent = best > 0 ? `最高分 ${best}` : '';
  history.replaceState(null, '', location.pathname);
  setTimeout(() => nameInput.focus(), 0);
}

// 單人（startWave 4 = Boss 挑戰）
function beginSolo(startWave = 0) {
  ensureAudio();
  mode = 'solo'; myId = 1; fx = createFx(myId);
  world.players.length = 0;
  addPlayer(world, { id: myId, name: takeName(), local: true });
  resetEffects(); lastResult = null;
  startRun(world, { startWave });
  menuEl.hidden = true; lobbyEl.hidden = true; pauseEl.hidden = true;
}

// 連線
function beginOnline(code) {
  ensureAudio();
  const name = takeName();
  errEl.textContent = '連線中…';
  net = connect({
    name, code, acct: accountCredentials(),
    onWelcome(m) {
      mode = 'online'; myId = m.id; fx = createFx(myId);
      resetEffects(); predictor.reset(); lastSnapSeen = -1;
      menuEl.hidden = true; pauseEl.hidden = true;
      lobbyEl.hidden = !!m.inProgress;   // 中途加入或重連：直接進戰場
      if (m.inProgress) world.scene = 'play';
      $('room-code').textContent = m.code;
      const url = `${location.origin}${location.pathname}?room=${m.code}`;
      $('room-link').textContent = url; $('room-link').href = url;
      history.replaceState(null, '', `?room=${m.code}`);
      if (m.resumed) toast('已重新連線，接回原本的角色');
      else if (m.inProgress) toast('加入進行中的戰鬥！');
    },
    onLobby(m) {
      hostId = m.hostId;
      $('lobby-players').innerHTML = m.players.map(p => `<li style="color:${p.color}">${p.id === m.hostId ? '👑 ' : ''}${escapeHtml(p.name)}${p.id === myId ? '（你）' : ''}</li>`).join('');
      const host = m.hostId === myId;
      $('lobby-start').hidden = !host; $('lobby-boss-row').hidden = !host;
      $('lobby-wait').hidden = host;
      $('lobby-start').textContent = m.players.length === 1 ? '單獨出擊（可等朋友加入）' : `全員出擊（${m.players.length} 人）`;
      if (m.scene === 'lobby' && world.scene !== 'play') { lobbyEl.hidden = false; world.scene = 'menu'; }
    },
    onStarted() { resetEffects(); predictor.reset(); lastSnapSeen = -1; lastResult = null; lobbyEl.hidden = true; pauseEl.hidden = true; world.scene = 'play'; },
    onResult(m) { lastResult = { rank: m.rank, mode: 'coop' }; toast(`合作排行榜 第 ${m.rank} 名`, 4000); },
    onReconnecting() { toast('連線中斷，重新連線中…', 1500); },
    onError(msg) { showMenu(msg); },
    onClose() { if (mode === 'online') showMenu('與伺服器的連線已中斷'); },
  });
}

$('solo').addEventListener('click', () => beginSolo(0));
$('solo-boss').addEventListener('click', () => beginSolo(4));
$('create').addEventListener('click', () => beginOnline(''));
$('join').addEventListener('click', () => { const c = codeInput.value.trim().toUpperCase(); if (!c) { errEl.textContent = '請輸入房號'; codeInput.focus(); return; } beginOnline(c); });
$('lobby-start').addEventListener('click', () => net?.start($('lobby-boss').checked));
$('lobby-leave').addEventListener('click', () => showMenu());
$('copy-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('room-link').href); $('copy-link').textContent = '已複製！'; setTimeout(() => $('copy-link').textContent = '複製邀請連結', 1500); } catch {} });
for (const el of [nameInput, codeInput]) el.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') { if (el === codeInput && codeInput.value.trim()) $('join').click(); else beginSolo(0); }
});

// ---------- 排行榜 ----------
const lb = { mode: 'solo', period: 'all' };
async function openLeaderboard() {
  lbEl.hidden = false;
  await refreshLeaderboard();
}
async function refreshLeaderboard() {
  for (const b of lbEl.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === lb.mode);
  for (const b of lbEl.querySelectorAll('[data-period]')) b.classList.toggle('on', b.dataset.period === lb.period);
  const rows = $('lb-rows'), meEl = $('lb-me');
  rows.innerHTML = '<li class="muted">載入中…</li>';
  try {
    const [data, meData] = await Promise.all([fetchLeaderboard(lb.mode, lb.period), fetchMe()]);
    const myId = getAccount()?.id;
    const st = meData?.stats?.[lb.mode];
    meEl.textContent = st ? `你的最佳：${st.best} 分（第 ${st.bestWave} 波）· 全部時間第 ${st.rank} 名 · 共 ${st.runs} 局` : '還沒有成績，去打一局吧！';
    if (!data.rows.length) { rows.innerHTML = '<li class="muted">還沒有人上榜，第一名就是你</li>'; return; }
    rows.innerHTML = data.rows.map((r, i) => {
      const mine = myId && r.party.some(p => p.id === myId);
      const names = r.party.map(p => escapeHtml(p.name)).join(' + ');
      return `<li class="${i < 3 ? 'top' + (i + 1) : ''}${mine ? ' me' : ''}"><span class="rk">#${i + 1}</span><span class="nm">${names}${lb.mode === 'coop' ? ` <small>${r.party.length} 人</small>` : ''}</span><span class="sc">${r.score.toLocaleString()}</span><span class="wv">第 ${r.wave} 波</span></li>`;
    }).join('');
  } catch (e) { rows.innerHTML = `<li class="muted">無法載入：${escapeHtml(e.message)}</li>`; }
}
$('open-lb').addEventListener('click', openLeaderboard);
$('lb-close').addEventListener('click', () => { lbEl.hidden = true; });
for (const b of lbEl.querySelectorAll('[data-mode]')) b.addEventListener('click', () => { lb.mode = b.dataset.mode; refreshLeaderboard(); });
for (const b of lbEl.querySelectorAll('[data-period]')) b.addEventListener('click', () => { lb.period = b.dataset.period; refreshLeaderboard(); });

// ---------- Esc 選單 ----------
function openPause() {
  if (world.scene === 'menu' || world.scene === 'gameover') return;
  if (mode === 'solo') { if (world.scene === 'play') togglePause(world); $('pause-title').textContent = '暫停'; $('pause-sub').textContent = '單人模式已暫停'; }
  else { $('pause-title').textContent = '選單'; $('pause-sub').textContent = '多人模式不會暫停，隊友仍在戰鬥'; }
  pauseEl.hidden = false;
}
function closePause() {
  pauseEl.hidden = true;
  if (mode === 'solo' && world.scene === 'pause') togglePause(world);
}
$('pause-resume').addEventListener('click', closePause);
$('pause-leave').addEventListener('click', () => showMenu());

// ---------- 輸入 ----------
attachInput(canvas, renderer.toWorld, {
  onKeyDown(code) {
    if (!menuEl.hidden || !lobbyEl.hidden) { if (code === 'Escape' && !lbEl.hidden) lbEl.hidden = true; return; }
    if (code === 'Escape') {
      if (!lbEl.hidden) { lbEl.hidden = true; return; }
      if (!pauseEl.hidden) closePause();
      else if (world.scene === 'gameover') showMenu();
      else openPause();
      return;
    }
    if (!pauseEl.hidden) return;
    if (code === 'KeyM') toggleMute();
    if (code === 'KeyP' && mode === 'solo') { if (world.scene === 'pause') closePause(); else openPause(); }
    if (code === 'Enter' && world.scene === 'gameover') { if (mode === 'solo') beginSolo(0); else if (hostId === myId) net?.start($('lobby-boss').checked); }
    if (world.scene === 'upgrade') {
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[code];
      if (n !== undefined) pickUpgrade(n);
    }
  },
  onMouseDown(button) {
    ensureAudio();
    if (button !== 0 || overlayOpen()) return;
    if (world.scene === 'gameover') { if (mode === 'solo') beginSolo(0); else if (hostId === myId) net?.start($('lobby-boss').checked); return; }
    if (world.scene === 'upgrade') {
      const i = renderer.upgradeCardRects().findIndex(r => mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h);
      if (i >= 0) pickUpgrade(i);
    }
  },
  onBlur() { if (mode === 'solo' && world.scene === 'play') openPause(); },
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
    if (p && !p.dead && !p.downed && world.scene === 'play' && net.curr && pauseEl.hidden) {
      if (net.snapCount !== lastSnapSeen) { lastSnapSeen = net.snapCount; predictor.reconcile(net.curr.players.find(q => q.id === myId)); }
      for (const inp of predictor.step(rawDt, st => buildInput(st))) net.sendInput(inp);
    } else if (p && (p.downed || !pauseEl.hidden) && world.scene === 'play') {
      // 倒地或開著選單：不送移動，但要讓伺服器知道我沒在射擊
      if (net.snapCount !== lastSnapSeen) { lastSnapSeen = net.snapCount; net.sendInput({ seq: 0, ix: 0, iy: 0, angle: p.angle, fire: false, dash: false }); predictor.reset(); }
    }
    const prevScene = world.scene;
    const events = net.applyTo(world, now);
    playEvents(events, fx, myId);
    const mine = me();
    if (mine && !mine.downed) predictor.applyTo(mine);
    if (net.curr && (world.scene === 'play' || world.scene === 'upgrade') && !lobbyEl.hidden) lobbyEl.hidden = true;
    if (prevScene !== 'gameover' && world.scene === 'gameover' && world.score > best) { best = world.score; localStorage.setItem('stardust_best', String(best)); }
    updateEffects(rawDt);
    renderer.updateStars(rawDt, mine);
  } else if (world.scene === 'play') {
    if (p) p.input = buildInput(p);
    if (vfx.hitStop > 0) vfx.hitStop -= rawDt;
    else {
      const dt = vfx.slowmo > 0 ? rawDt * 0.35 : rawDt;
      const prevScene = world.scene;
      update(world, dt, fx);
      updateEffects(dt);
      renderer.updateStars(dt, p);
      if (prevScene !== 'gameover' && world.scene === 'gameover') {
        if (world.score > best) { best = world.score; localStorage.setItem('stardust_best', String(best)); }
        submitSoloRun(world.score, world.wave).then(r => { if (r) { lastResult = { rank: r.rank, mode: 'solo' }; toast(`單人排行榜 第 ${r.rank} 名`, 4000); } });
      }
    }
  } else {
    updateEffects(rawDt);
    renderer.updateStars(rawDt, null);
  }
  decayEffects(rawDt);
  renderer.draw({ time: uiTime, mouse, me: me(), best, muted: isMuted(), online: mode === 'online', isHost: hostId === myId, result: lastResult });
  requestAnimationFrame(loop);
}
showMenu();
if (codeInput.value) $('join').click(); // 用邀請連結進來：自動加入
requestAnimationFrame(loop);

// 除錯 / 自動測試用
window.__dbg = () => ({ world, vfx, me: me(), mode, net, predictor, hostId });
