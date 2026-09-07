// 客戶端進入點：組裝世界、渲染、輸入、特效，跑主迴圈。
// 兩種模式：
//   solo   — 本機直接跑 game.js 的 update()
//   online — 連到伺服器房間；伺服器跑 update()，這裡送輸入、收快照插值、播放 fx 事件、預測自己的機體
import { createWorld, addPlayer, startRun, update, chooseUpgrade, togglePause, abandonRun, continueEndless, finishRun } from './game.js';
import { createRenderer } from './render.js';
import { attachInput, buildInput, mouse, touch } from './input.js';
import { createFx, vfx, resetEffects, updateEffects, decayEffects } from './effects.js';
import { ensureAudio, toggleMute, isMuted } from './audio.js';
import { connect, playEvents } from './net.js';
import { createPredictor } from './predict.js';
import { sanitizeName, NAME_MAX_LEN, PERKS, perkLevels, SHIPS, shipById, shipUnlocked } from '../../shared/constants.js';
import { seedRandom } from '../../shared/math.js';
import { DAILY_MODS } from '../../shared/daily.js';
import './themes.js';   // 套用霓虹主題（唯一風格）
import { track } from './analytics.js';
import { ensureAccount, accountCredentials, submitRun, fetchLeaderboard, fetchMe, getAccount, profile, buyPerk, fetchDaily, startDaily } from './account.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const menuEl = $('menu'), lobbyEl = $('lobby'), pauseEl = $('pause'), toastEl = $('toast'), lbEl = $('leaderboard'), hangarEl = $('hangar'), dailyEl = $('daily'), helpEl = $('help'), privacyEl = $('privacy');
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
let leftTeam = false;    // 多人：主動離開隊伍後的本機結算畫面
let soloSubmitted = false;
let ship = localStorage.getItem('stardust_ship') || 'falcon';   // 出擊用的機體
let runKind = 'solo';
let runStartedAt = 0;   // 事件記錄用    // solo | daily（單機模式的成績歸類）
let dailyInfo = null;    // 進行中的每日挑戰 {key, seed, mods}
const me = () => world.players.find(p => p.id === myId);
const overlayOpen = () => !menuEl.hidden || !lobbyEl.hidden || !pauseEl.hidden || !lbEl.hidden || !hangarEl.hidden || !dailyEl.hidden || !helpEl.hidden || !privacyEl.hidden;

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
  hangarEl.hidden = true; dailyEl.hidden = true;
  seedRandom(null); runKind = 'solo'; dailyInfo = null;
  renderDust();
  fetchMe().then(renderDust);
  history.replaceState(null, '', location.pathname);
  setTimeout(() => nameInput.focus(), 0);
}

// 單人（startWave 4 = Boss 挑戰）
function goFullscreenIfTouch() {
  if (!touch.active && !matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
}
function beginSolo(startWave = 0, daily = null) {
  ensureAudio(); goFullscreenIfTouch();
  mode = 'solo'; myId = 1; fx = createFx(myId);
  world.players.length = 0;
  runKind = daily ? 'daily' : 'solo'; dailyInfo = daily;
  seedRandom(daily ? daily.seed : null);   // 每日挑戰：固定種子，全球同樣的敵人組合
  addPlayer(world, { id: myId, name: takeName(), local: true, perks: profile.unlocks, ship: currentShip() });
  resetEffects(); lastResult = null; leftTeam = false; soloSubmitted = false;
  startRun(world, { startWave, mods: daily ? daily.mods : null, daily: !!daily });
  runStartedAt = performance.now();
  track('run_start', { mode: runKind, ship: currentShip(), wave0: world.wave, boss: startWave > 0 });
  menuEl.hidden = true; lobbyEl.hidden = true; pauseEl.hidden = true; hangarEl.hidden = true; dailyEl.hidden = true;
  if (daily) toast('每日挑戰：' + daily.mods.map(id => DAILY_MODS.find(m => m.id === id)?.name).join(' + '), 3500);
}
function currentShip() { if (!shipUnlocked(ship, profile.unlocks)) ship = 'falcon'; return ship; }
function renderShips() {
  const cur = currentShip(), s0 = shipById(cur);
  $('ship-name').textContent = `${s0.icon} ${s0.name}`;
  const bar = (v) => { const w = Math.min(100, v * 62); return `<b><i class="${v > 1.02 ? 'hi' : v < 0.98 ? 'lo' : ''}" style="width:${w}%"></i></b>`; };
  $('ship-cards').innerHTML = SHIPS.map(s => {
    const un = shipUnlocked(s.id, profile.unlocks);
    return `<div class="ship ${s.id === cur ? 'on' : ''} ${un ? '' : 'locked'}" data-ship="${s.id}"><div class="ic">${s.icon}</div><div class="nm">${s.name}</div><div class="st"><span>生命</span>${bar(s.stats.hp)}<span>速度</span>${bar(s.stats.speed)}<span>射速</span>${bar(s.stats.fire)}<span>傷害</span>${bar(s.stats.dmg)}</div><div class="ds">${s.desc}</div><div class="cost ${un ? 'ok' : ''}">${un ? (s.id === cur ? '✔ 出擊中' : '已解鎖') : '✨ ' + s.cost}</div></div>`;
  }).join('');
  for (const el of $('ship-cards').querySelectorAll('.ship')) el.addEventListener('click', async () => {
    const id = el.dataset.ship;
    $('hangar-err').textContent = '';
    if (shipUnlocked(id, profile.unlocks)) { ship = id; localStorage.setItem('stardust_ship', id); ensureAudio(); renderShips(); return; }
    const s = shipById(id);
    if (profile.dust < s.cost) { $('hangar-err').textContent = `星塵不足，解鎖 ${s.name} 需要 ${s.cost}`; return; }
    try { await buyPerk('ship:' + id); ship = id; localStorage.setItem('stardust_ship', id); ensureAudio(); renderHangar(); toast(`已解鎖 ${s.icon} ${s.name}`); }
    catch (e) { $('hangar-err').textContent = { 'not enough dust': '星塵不足', offline: '目前離線，無法解鎖' }[e.message] || e.message; }
  });
}
function renderDust() {
  renderShips(); $('dust').textContent = '✨ ' + profile.dust.toLocaleString(); $('hangar-dust').textContent = `✨ 星塵 ${profile.dust.toLocaleString()}（累計 ${profile.dustTotal.toLocaleString()}）`; }

// ---------- 機庫：永久強化 ----------
function renderHangar() {
  renderDust();
  const lv = perkLevels(profile.unlocks);
  $('perk-rows').innerHTML = PERKS.map(k => {
    const l = lv[k.id] || 0, maxed = l >= k.max, cost = maxed ? 0 : k.cost[l];
    const dots = Array.from({ length: k.max }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
    return `<li><span class="ic">${k.icon}</span><span><span class="nm">${k.name}</span><span class="lv">${dots}</span><div class="ds">${k.desc(Math.max(1, Math.min(k.max, l + 1)))}${l ? `（目前：${k.desc(l)}）` : ''}</div></span><button data-perk="${k.id}" class="${maxed ? 'max' : ''}" ${maxed || profile.dust < cost ? 'disabled' : ''}>${maxed ? '已滿級' : '✨ ' + cost}</button></li>`;
  }).join('');
  for (const b of $('perk-rows').querySelectorAll('button[data-perk]')) b.addEventListener('click', async () => {
    $('hangar-err').textContent = '';
    try { await buyPerk(b.dataset.perk); ensureAudio(); renderHangar(); toast('購買成功，下一局開始生效'); }
    catch (e) { $('hangar-err').textContent = { 'not enough dust': '星塵不足', 'max level': '已達上限', offline: '目前離線，無法購買' }[e.message] || e.message; }
  });
}
$('open-help').addEventListener('click', () => { helpEl.hidden = false; });
$('help-close').addEventListener('click', () => { helpEl.hidden = true; });
$('open-privacy').addEventListener('click', () => { privacyEl.hidden = false; });
$('privacy-close').addEventListener('click', () => { privacyEl.hidden = true; });
$('open-hangar').addEventListener('click', async () => { hangarEl.hidden = false; renderHangar(); await fetchMe(); renderHangar(); });
$('hangar-close').addEventListener('click', () => { hangarEl.hidden = true; renderDust(); });

// ---------- 每日挑戰 ----------
let dailyToday = null;
async function openDaily() {
  dailyEl.hidden = false;
  $('daily-status').textContent = '載入中…'; $('daily-start').disabled = true;
  try {
    dailyToday = await fetchDaily();
    $('daily-date').textContent = `${dailyToday.key} · 全球玩家同一組敵人與規則 · 一天一次`;
    $('daily-mods').innerHTML = dailyToday.mods.map(id => { const m = DAILY_MODS.find(x => x.id === id); return `<li><span class="ic">${m.icon}</span><span><div class="nm">${m.name}</div><div class="ds">${m.desc}</div></span></li>`; }).join('');
    if (dailyToday.run) { $('daily-status').textContent = `今天已完成：${dailyToday.run.score} 分（第 ${dailyToday.run.wave} 波）· 今日第 ${dailyToday.run.rank} 名`; $('daily-start').textContent = '明天再來'; }
    else if (dailyToday.started) { $('daily-status').textContent = '今天的挑戰已開始過（中途離開也算一次）'; $('daily-start').textContent = '明天再來'; }
    else { $('daily-status').textContent = '尚未挑戰'; $('daily-start').textContent = '出擊'; $('daily-start').disabled = false; }
  } catch (e) { $('daily-status').textContent = '無法連線到伺服器：' + e.message; }
}
$('open-daily').addEventListener('click', openDaily);
$('daily-close').addEventListener('click', () => { dailyEl.hidden = true; });
$('daily-lb').addEventListener('click', () => { lb.mode = 'daily'; openLeaderboard(); });
$('daily-start').addEventListener('click', async () => {
  $('daily-start').disabled = true;
  try { const r = await startDaily(); beginSolo(0, { key: r.key, seed: r.seed, mods: r.mods }); }
  catch (e) { $('daily-status').textContent = e.message === 'daily already played' ? '今天已經挑戰過了' : '無法開始：' + e.message; }
});

// 連線
function beginOnline(code) {
  ensureAudio(); goFullscreenIfTouch();
  const name = takeName();
  errEl.textContent = '連線中…';
  net = connect({
    name, code, acct: accountCredentials(), ship: currentShip(),
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
      $('lobby-players').innerHTML = m.players.map(p => `<li style="color:${p.color}">${p.id === m.hostId ? '👑 ' : ''}${shipById(p.ship).icon} ${escapeHtml(p.name)}${p.id === myId ? '（你）' : ''}</li>`).join('');
      const host = m.hostId === myId;
      $('lobby-start').hidden = !host; $('lobby-boss-row').hidden = !host;
      $('lobby-wait').hidden = host;
      $('lobby-start').textContent = m.players.length === 1 ? '單獨出擊（可等朋友加入）' : `全員出擊（${m.players.length} 人）`;
      if (m.scene === 'lobby' && world.scene !== 'play') { lobbyEl.hidden = false; world.scene = 'menu'; }
    },
    onStarted() { runStartedAt = performance.now(); track('run_start', { mode: 'coop', ship: currentShip() }); resetEffects(); predictor.reset(); lastSnapSeen = -1; lastResult = null; leftTeam = false; lobbyEl.hidden = true; pauseEl.hidden = true; world.scene = 'play'; },
    onResult(m) { const d = m.dustBy?.[getAccount()?.id] || 0; if (d) { profile.dust += d; profile.dustTotal += d; } lastResult = { rank: m.rank, mode: 'coop', dust: d }; toast(`${m.rank ? `合作排行榜 第 ${m.rank} 名 · ` : ''}星塵 +${d}`, 4000); },
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
  for (const b of lbEl.querySelectorAll('[data-period]')) { b.classList.toggle('on', b.dataset.period === lb.period); b.hidden = lb.mode === 'daily'; }
  const rows = $('lb-rows'), meEl = $('lb-me');
  rows.innerHTML = '<li class="muted">載入中…</li>';
  try {
    const [data, meData] = await Promise.all([fetchLeaderboard(lb.mode, lb.period), fetchMe()]);
    const myId = getAccount()?.id;
    const st = meData?.stats?.[lb.mode];
    if (lb.mode === 'daily') meEl.textContent = `今日挑戰（${data.day}）· 每人一次`;
    else meEl.textContent = st ? `你的最佳：${st.best} 分（第 ${st.bestWave} 波）· 全部時間第 ${st.rank} 名 · 共 ${st.runs} 局` : '還沒有成績，去打一局吧！';
    renderDust();
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
  if (world.scene === 'menu' || world.scene === 'gameover' || world.scene === 'victory') return;
  if (mode === 'solo') { if (world.scene === 'play') togglePause(world); $('pause-title').textContent = '暫停'; $('pause-sub').textContent = '單人模式已暫停'; }
  else { $('pause-title').textContent = '選單'; $('pause-sub').textContent = '多人模式不會暫停，隊友仍在戰鬥'; }
  pauseEl.hidden = false;
}
function closePause() {
  pauseEl.hidden = true;
  if (mode === 'solo' && world.scene === 'pause') togglePause(world);
}
$('pause-resume').addEventListener('click', closePause);
$('pause-leave').addEventListener('click', leaveGame);
/** 單人：這局結束並上傳成績；多人：離開隊伍，留在結算畫面 */
function runEndProps(reason) {
  const p = me() || {};
  return { mode: runKind, ship: p.ship || currentShip(), wave: world.wave, score: world.score, reason, dur: Math.round((performance.now() - runStartedAt) / 1000), kills: p.kills || 0, ups: Object.keys(p.upgrades || {}), syn: Object.keys(p.syn || {}) };
}
function finishSoloRun() {
  if (soloSubmitted) return;
  soloSubmitted = true;
  track('run_end', runEndProps(world.abandoned ? 'abandon' : world.won ? (world.endless ? 'endless' : 'victory') : 'dead'));
  if (world.score > best) { best = world.score; localStorage.setItem('stardust_best', String(best)); }
  const kind = runKind, day = dailyInfo?.key || null;
  submitRun(world.score, world.wave, { mode: kind, day }).then(r => {
    if (!r) return;
    lastResult = { rank: r.rank, mode: kind, dust: r.dust };
    renderDust();
    toast(`${kind === 'daily' ? '今日挑戰' : '單人排行榜'}${r.rank ? ` 第 ${r.rank} 名` : ''} · 星塵 +${r.dust}`, 4000);
  });
}
function leaveGame() {
  pauseEl.hidden = true;
  if (world.scene === 'gameover' || world.scene === 'menu') { showMenu(); return; }
  if (mode === 'solo') {
    if (world.scene === 'pause') togglePause(world);
    if (abandonRun(world)) { fx.sfx('gameover'); finishSoloRun(); }
    else showMenu();
    return;
  }
  // 多人：通知伺服器離隊（隊友繼續打），本機切到結算畫面
  const n = net; net = null; mode = 'solo';
  n.send({ t: 'leave' }); n.close();
  track('run_end', runEndProps('left'));
  predictor.reset();
  world.scene = 'gameover'; world.abandoned = true; leftTeam = true; lastResult = null;
  history.replaceState(null, '', location.pathname);
  fx.sfx('gameover');
}

// ---------- 輸入 ----------
attachInput(canvas, renderer.toWorld, {
  onKeyDown(code) {
    if (!menuEl.hidden || !lobbyEl.hidden) { if (code === 'Escape') { if (!lbEl.hidden) lbEl.hidden = true; else if (!hangarEl.hidden) hangarEl.hidden = true; else if (!dailyEl.hidden) dailyEl.hidden = true; else if (!helpEl.hidden) helpEl.hidden = true; else if (!privacyEl.hidden) privacyEl.hidden = true; } return; }
    if (code === 'Escape') {
      if (!lbEl.hidden) { lbEl.hidden = true; return; }
      if (world.scene === 'victory') { victoryChoice(false); return; }
      if (!pauseEl.hidden) closePause();
      else if (world.scene === 'gameover') showMenu();
      else openPause();
      return;
    }
    if (!pauseEl.hidden) return;
    if (code === 'KeyL' && world.scene === 'gameover') { lb.mode = leftTeam || mode === 'online' ? 'coop' : runKind; openLeaderboard(); return; }
    if (code === 'KeyM') toggleMute();
    if (code === 'KeyP' && mode === 'solo') { if (world.scene === 'pause') closePause(); else openPause(); }
    if (world.scene === 'victory') { if (code === 'Enter') victoryChoice(true); return; }
    if (code === 'Enter' && world.scene === 'gameover') { if (leftTeam || runKind === 'daily') showMenu(); else if (mode === 'solo') beginSolo(0); else if (hostId === myId) net?.start($('lobby-boss').checked); }
    if (world.scene === 'upgrade') {
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[code];
      if (n !== undefined) pickUpgrade(n);
    }
  },
  onMouseDown(button) {
    ensureAudio();
    if (button !== 0 || overlayOpen()) return;
    if (world.scene === 'victory') { victoryChoice(true); return; }
    if (world.scene === 'gameover') { if (leftTeam || runKind === 'daily') showMenu(); else if (mode === 'solo') beginSolo(0); else if (hostId === myId) net?.start($('lobby-boss').checked); return; }
    if (world.scene === 'upgrade') {
      const i = renderer.upgradeCardRects().findIndex(r => mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h);
      if (i >= 0) pickUpgrade(i);
    }
  },
  onBlur() { if (mode === 'solo' && world.scene === 'play') openPause(); },
  onMenuTap() { if (overlayOpen()) return; if (world.scene === 'gameover') showMenu(); else openPause(); },
  isTapScene() { return world.scene === 'upgrade' || world.scene === 'gameover' || world.scene === 'menu' || world.scene === 'victory'; },
});
/** 勝利畫面：true = 繼續無盡模式，false = 結束並結算（多人只有房主能決定） */
function victoryChoice(endless) {
  if (mode === 'solo') { if (endless) { continueEndless(world); toast('無盡模式：敵人會持續變強', 3000); } else { finishRun(world); fx.sfx('gameover'); finishSoloRun(); } }
  else if (hostId === myId) net?.send({ t: endless ? 'endless' : 'finish' });
}
function pickUpgrade(i) {
  const c = world.pendingUpgrades.get(myId)?.[i]; if (c) track('upgrade', { id: c.id, wave: world.wave });
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
      for (const inp of predictor.step(rawDt, st => buildInput(st, world))) net.sendInput(inp);
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
    if (prevScene !== 'gameover' && world.scene === 'gameover') { if (world.score > best) { best = world.score; localStorage.setItem('stardust_best', String(best)); } track('run_end', { ...runEndProps(world.won ? 'victory' : 'dead'), mode: 'coop' }); }
    updateEffects(rawDt);
    renderer.updateStars(rawDt, mine);
  } else if (world.scene === 'play') {
    if (p) p.input = buildInput(p, world);
    if (vfx.hitStop > 0) vfx.hitStop -= rawDt;
    else {
      const dt = vfx.slowmo > 0 ? rawDt * 0.35 : rawDt;
      const prevScene = world.scene;
      update(world, dt, fx);
      updateEffects(dt);
      renderer.updateStars(dt, p);
      if (prevScene !== 'gameover' && world.scene === 'gameover') finishSoloRun();
    }
  } else {
    updateEffects(rawDt);
    renderer.updateStars(rawDt, null);
  }
  decayEffects(rawDt);
  renderer.draw({ time: uiTime, mouse, me: me(), best, muted: isMuted(), online: mode === 'online', isHost: hostId === myId, result: lastResult, left: leftTeam, daily: runKind === 'daily' });
  requestAnimationFrame(loop);
}
showMenu();
if (codeInput.value) $('join').click(); // 用邀請連結進來：自動加入
requestAnimationFrame(loop);

// 除錯 / 自動測試用
window.__dbg = () => ({ world, vfx, me: me(), mode, net, predictor, hostId });
