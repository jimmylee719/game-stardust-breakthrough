// 客戶端進入點：組裝世界、渲染、輸入、特效，跑主迴圈。
// 兩種模式：
//   solo   — 本機直接跑 game.js 的 update()
//   online — 連到伺服器房間；伺服器跑 update()，這裡送輸入、收快照插值、播放 fx 事件、預測自己的機體
import { createWorld, addPlayer, startRun, update, chooseUpgrade, togglePause, abandonRun, continueEndless, finishRun } from './game.js';
import { createRenderer } from './render.js';
import { attachInput, buildInput, mouse, touch, opts, saveOpts, autoAimOn, autoFireOn } from './input.js';
import { createFx, vfx, resetEffects, updateEffects, decayEffects, trackFrame } from './effects.js';
import { ensureAudio, toggleMute, isMuted, setMood, getMusicVolume, setMusicVolume, getSfxEnabled, setSfxEnabled } from './audio.js';
import { connect, playEvents } from './net.js';
import { createPredictor } from './predict.js';
import { SKILLS, skillById, skillUnlocked, sanitizeName, NAME_MAX_LEN, PERKS, perkLevels, SHIPS, shipById, shipUnlocked, WEAPONS, weaponById, weaponUnlocked, SKINS, skinById, skinUnlocked, ARENAS, arenaById, WEAPON_MODS, ELEMENTS, AFFINITY, EVENTS, ENEMY_TYPES, BOSS_KINDS, WEAPON_ELEMENT, EVOLUTIONS } from '../../shared/constants.js';
import { seedRandom } from '../../shared/math.js';
import { DAILY_MODS, dayKey } from '../../shared/daily.js';
import { ACHIEVEMENTS, QUESTS, dailyQuests, weeklyQuests, questText, runSummary, weekKey } from '../../shared/meta.js';
import { tr, getLang, setLang, applyDom, registerZhHtml, onLangChange } from './i18n.js';
import './themes.js';   // 套用霓虹主題（唯一風格）
import { track } from './analytics.js';
import { ensureAccount, accountCredentials, submitRun, fetchLeaderboard, fetchMe, getAccount, profile, buyPerk, fetchDaily, startDaily, exportCode, importCode, fetchMeta, reportRun, fetchRooms, quickMatch } from './account.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const menuEl = $('menu'), lobbyEl = $('lobby'), pauseEl = $('pause'), toastEl = $('toast'), lbEl = $('leaderboard'), hangarEl = $('hangar'), dailyEl = $('daily'), helpEl = $('help'), privacyEl = $('privacy');
const settingsEl = $('settings'), roomsEl = $('rooms'), questsEl = $('quests'), achEl = $('ach'), codexEl = $('codex');
const nameInput = $('name'), codeInput = $('code');
const errEl = $('err'), bestEl = $('best');
const OVERLAYS = [menuEl, lobbyEl, pauseEl, lbEl, hangarEl, dailyEl, helpEl, privacyEl, settingsEl, roomsEl, questsEl, achEl, codexEl];

// 說明 / 隱私的中文版存起來，切語言時可以切回來
registerZhHtml('help', $('help-body').innerHTML); registerZhHtml('privacy', $('privacy-body').innerHTML);
applyDom();

const world = createWorld();
const renderer = createRenderer(canvas, world);
let mode = 'solo';
let net = null;
let myId = 1;
let hostId = null;
let fx = createFx(myId);
const lsGet = (k, d = null) => { try { return lsGet(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { lsSet(k, v); } catch {} };
let best = +(lsGet('stardust_best') || 0);
let uiTime = 0;
const predictor = createPredictor(world);
let lastSnapSeen = -1;
let toastTimer = 0;
let lastResult = null;   // 結算畫面用：{ rank, mode }
let leftTeam = false;    // 多人：主動離開隊伍後的本機結算畫面
let soloSubmitted = false;
let ship = lsGet('stardust_ship') || 'falcon';   // 出擊用的機體
let weapon = lsGet('stardust_weapon') || 'blaster';   // 出擊用的主武器
let skin = lsGet('stardust_skin') || 'classic';       // 塗裝
let arena = lsGet('stardust_arena') || 'space';       // 場地
let skillSel = lsGet('stardust_skill') || 'swarm';    // 主動技能
let runKind = 'solo';
let runStartedAt = 0;   // 事件記錄用    // solo | daily（單機模式的成績歸類）
let dailyInfo = null;    // 進行中的每日挑戰 {key, seed, mods}
let metaReported = false;
let roomArena = 'space', roomPublic = false;
const me = () => world.players.find(p => p.id === myId);
const overlayOpen = () => OVERLAYS.some(el => !el.hidden);

// ---------- 小工具 ----------
function toast(msg, ms = 2500) { toastEl.textContent = tr(msg); toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function takeName() {
  const name = sanitizeName(nameInput.value);
  nameInput.value = name;
  lsSet('stardust_name', name);
  ensureAccount(name);   // 背景同步匿名帳號（首次自動註冊）
  return name;
}
const T = s => escapeHtml(tr(s));

// ---------- 場地選擇 ----------
function renderArenas(container, current, onPick, disabled = false) {
  container.innerHTML = ARENAS.map(a => `<div class="arena ${a.id === current ? 'on' : ''}" data-arena="${a.id}" title="${escapeHtml(a.desc)}"><div class="ic">${a.icon}</div><div class="nm">${T(a.name)}</div></div>`).join('');
  if (!disabled) for (const el of container.querySelectorAll('.arena')) el.addEventListener('click', () => { ensureAudio(); onPick(el.dataset.arena); });
  const A = arenaById(current);
  let d = container.nextElementSibling;
  if (!d || !d.classList.contains('arena-desc')) { d = document.createElement('div'); d.className = 'arena-desc'; container.after(d); }
  d.textContent = `${tr(A.desc)}${getLang() === 'zh' ? '。' + A.hazard : ''}`;
}
function renderMenuArenas() { renderArenas($('arena-cards'), arena, id => { arena = id; lsSet('stardust_arena', id); world.arena = id; renderMenuArenas(); requestAnimationFrame(fitMenu); }); }

// ---------- 選單 ----------
nameInput.maxLength = NAME_MAX_LEN;
nameInput.value = lsGet('stardust_name') || '';
codeInput.value = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
function showMenu(msg = '') {
  if (net) { net.close(); net = null; }
  mode = 'solo';
  world.scene = 'menu'; world.players.length = 0;
  for (const el of OVERLAYS) el.hidden = true;
  menuEl.hidden = false;
  errEl.textContent = msg;
  bestEl.textContent = best > 0 ? tr(`最高 ${best}`) : '';
  renderMenuArenas();
  requestAnimationFrame(fitMenu); setTimeout(fitMenu, 350);
  seedRandom(null); runKind = 'solo'; dailyInfo = null;
  renderDust();
  fetchMe().then(renderDust);
  history.replaceState(null, '', location.pathname);
  setTimeout(() => nameInput.focus(), 0);
}

/** 全螢幕：任何裝置按下出擊都進全螢幕（需要使用者手勢）；手機另外鎖橫向 */
function goFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!document.fullscreenElement && req) {
    try { const p = req.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); } catch {}
  }
  if (matchMedia('(pointer: coarse)').matches && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  // iOS Safari 沒有全螢幕 API：提醒一次用「加入主畫面」（PWA）才會全螢幕
  if (!req && /iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone && !lsGet('stardust_ioshint')) { lsSet('stardust_ioshint', '1'); setTimeout(() => toast(tr('iPhone / iPad：用 Safari「分享 → 加入主畫面」開啟，才會全螢幕沒有網址列'), 7000), 800); }
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else goFullscreen();
}
/** 首頁面板：依視窗大小整塊縮放，保證所有資訊同時看得到、不出現捲軸 */
function fitMenu() { fitPanel(menuEl); fitPanel(hangarEl); }
/** 面板整塊縮放：首頁一律；機庫只在寬螢幕（窄螢幕退回捲動） */
function fitPanel(overlay) {
  const box = overlay.querySelector('.fitbox'), panel = box && box.querySelector('.panel');
  if (!panel || overlay.hidden) return;
  if (overlay !== menuEl && innerWidth < 900) { box.style.zoom = '1'; return; }
  // 用 zoom（會跟著改版面尺寸，置中正確、放得下就不會出現捲軸）；入場動畫的 transform 在 .panel 上，不會互相覆蓋
  box.style.zoom = '1';
  const s = Math.min(1, (innerHeight - 16) / panel.offsetHeight, (innerWidth - 12) / panel.offsetWidth);
  box.style.zoom = s < 1 ? Math.max(0.5, s).toFixed(3) : '1';   // 最小縮到 0.5，再放不下就讓覆蓋層捲動
}
// resize 事件有時在版面重排前就觸發（媒體查詢切欄、字型載入）→ 下一幀再量一次，並用 ResizeObserver 盯著面板尺寸
window.addEventListener('resize', () => { fitMenu(); requestAnimationFrame(fitMenu); setTimeout(fitMenu, 150); setTimeout(fitMenu, 450); });
if ('ResizeObserver' in window) { const ro = new ResizeObserver(() => fitMenu()); for (const el of [menuEl, hangarEl]) { const pn = el.querySelector('.panel'); if (pn) ro.observe(pn); } }
window.addEventListener('orientationchange', () => { setTimeout(() => { renderer.resize(); fitMenu(); }, 300); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { renderer.resize(); fitMenu(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitMenu());
document.addEventListener('fullscreenchange', () => { fitMenu(); const b = $('fs-toggle'); if (b) b.textContent = document.fullscreenElement ? '🗗' : '⛶'; });
$('fs-toggle').addEventListener('click', toggleFullscreen);
$('lang-toggle').addEventListener('click', () => { setLang(getLang() === 'zh' ? 'en' : 'zh'); });
function refreshLangUi() { $('lang-toggle').textContent = getLang() === 'zh' ? 'EN' : '中'; $('opt-lang').value = getLang(); renderMenuArenas(); renderDust(); bestEl.textContent = best > 0 ? tr(`最高 ${best}`) : ''; requestAnimationFrame(fitMenu); }
onLangChange(refreshLangUi); refreshLangUi();

function beginSolo(startWave = 0, daily = null) {
  ensureAudio(); goFullscreen();
  mode = 'solo'; myId = 1; fx = createFx(myId);
  world.players.length = 0;
  runKind = daily ? 'daily' : 'solo'; dailyInfo = daily;
  seedRandom(daily ? daily.seed : null);   // 每日挑戰：固定種子，全球同樣的敵人組合
  addPlayer(world, { id: myId, name: takeName(), local: true, perks: profile.unlocks, ship: currentShip(), weapon: currentWeapon(), skin: currentSkin(), skill: currentSkill() });
  resetEffects(); lastResult = null; leftTeam = false; soloSubmitted = false; metaReported = false;
  startRun(world, { startWave, mods: daily ? daily.mods : null, daily: !!daily, arena: daily ? 'space' : arena });
  runStartedAt = performance.now();
  track('run_start', { mode: runKind, ship: currentShip(), weapon: currentWeapon(), arena: world.arena, wave0: world.wave, boss: startWave > 0 });
  for (const el of OVERLAYS) el.hidden = true;
  if (daily) toast('每日挑戰：' + daily.mods.map(id => DAILY_MODS.find(m => m.id === id)?.name).join(' + '), 3500);
}
function currentShip() { if (!shipUnlocked(ship, profile.unlocks)) ship = 'falcon'; return ship; }
function currentWeapon() { if (!weaponUnlocked(weapon, profile.unlocks)) weapon = 'blaster'; return weapon; }
function currentSkin() { if (!skinUnlocked(skin, profile.unlocks)) skin = 'classic'; return skin; }
function currentSkill() { if (!skillUnlocked(skillSel, profile.unlocks)) skillSel = 'swarm'; return skillSel; }
function renderSkillCards() {
  const cur = currentSkill();
  $('skill-cards').innerHTML = SKILLS.map(s => {
    const un = skillUnlocked(s.id, profile.unlocks);
    return `<div class="ship ${s.id === cur ? 'on' : ''} ${un ? '' : 'locked'}" data-skill="${s.id}"><div class="ic">${s.icon}</div><div class="nm">${T(s.name)}</div><div class="ds">${escapeHtml(tr(s.desc))}<br><span style="color:#b8ffff">⚡ ${s.energy}</span></div>${un ? `<div class="cost ok">${s.id === cur ? tr('使用中') : tr('已解鎖')}</div>` : `<div class="cost">✨ ${s.cost}</div>`}</div>`;
  }).join('');
  for (const el of $('skill-cards').querySelectorAll('.ship')) el.addEventListener('click', async () => {
    const id = el.dataset.skill;
    $('hangar-err').textContent = '';
    if (skillUnlocked(id, profile.unlocks)) { skillSel = id; lsSet('stardust_skill', id); ensureAudio(); renderSkillCards(); return; }
    const s = skillById(id);
    if (profile.dust < s.cost) { $('hangar-err').textContent = tr(`星塵不足，解鎖 ${s.name} 需要 ${s.cost}`); return; }
    try { await buyPerk('skill:' + id); skillSel = id; lsSet('stardust_skill', id); ensureAudio(); renderHangar(); toast(tr(`已解鎖 ${s.icon} ${s.name}`)); }
    catch (e) { $('hangar-err').textContent = { 'not enough dust': tr('星塵不足'), offline: tr('目前離線，無法解鎖') }[e.message] || e.message; }
  });
}
function renderSkins() {
  const cur = currentSkin();
  $('skin-cards').innerHTML = SKINS.map(s => {
    const un = skinUnlocked(s.id, profile.unlocks);
    return `<div class="ship ${s.id === cur ? 'on' : ''} ${un ? '' : 'locked'}" data-skin="${s.id}"><div class="sw" style="background:${s.hull};border-color:${s.stroke || '#4cc9f0'};box-shadow:0 0 10px ${s.glow || '#4cc9f0'}"></div><div class="nm">${T(s.name)}</div><div class="cost ${un ? 'ok' : ''}">${un ? (s.id === cur ? tr('✔ 使用中') : tr('已解鎖')) : '✨ ' + s.cost}</div></div>`;
  }).join('');
  for (const el of $('skin-cards').querySelectorAll('.ship')) el.addEventListener('click', async () => {
    const id = el.dataset.skin;
    $('hangar-err').textContent = '';
    if (skinUnlocked(id, profile.unlocks)) { skin = id; lsSet('stardust_skin', id); ensureAudio(); renderSkins(); return; }
    const s = skinById(id);
    if (profile.dust < s.cost) { $('hangar-err').textContent = `星塵不足，解鎖 ${s.name} 塗裝需要 ${s.cost}`; return; }
    try { await buyPerk('skin:' + id); skin = id; lsSet('stardust_skin', id); ensureAudio(); renderHangar(); toast(`已解鎖塗裝 ${s.name}`); }
    catch (e) { $('hangar-err').textContent = { 'not enough dust': '星塵不足', offline: '目前離線，無法解鎖' }[e.message] || e.message; }
  });
}
function renderWeapons() {
  const cur = currentWeapon(), meleeOnly = shipById(currentShip()).id === 'ronin';
  $('weapon-cards').innerHTML = WEAPONS.map(w => {
    const un = weaponUnlocked(w.id, profile.unlocks);
    const el = ELEMENTS[WEAPON_ELEMENT[w.id] === 'kinetic' || WEAPON_ELEMENT[w.id] === 'light' ? 'neutral' : WEAPON_ELEMENT[w.id]];
    const evo = EVOLUTIONS.find(e => e.weapon === w.id);
    return `<div class="ship ${w.id === cur ? 'on' : ''} ${un ? '' : 'locked'}" data-weapon="${w.id}"><div class="ic">${w.icon}</div><div class="nm">${T(w.name)}</div><div class="ds">${escapeHtml(tr(w.desc))}<br><span style="color:#ffd166">${evo ? `${evo.icon} ${tr("進化")}：${tr(evo.name)}` : ''}</span></div><div class="cost ${un ? 'ok' : ''}">${un ? (w.id === cur ? tr('✔ 裝備中') : tr('已解鎖')) : '✨ ' + w.cost}</div></div>`;
  }).join('');
  const M = WEAPON_MODS[cur] || {}, names = { spread: '散射道具', rapid: '連射道具', pierce: '穿甲彈', bounce: '反彈彈', homing: '追蹤導引', bigshot: '巨型彈體' };
  $('weapon-mods').innerHTML = `${meleeOnly ? `<div style="color:#ff8c9c">${tr('劍聖只能使用光刃。')}</div>` : ''}<div><b>${T(weaponById(cur).name)}</b> ${tr('對升級 / 道具的反應：')}</div>` + Object.entries(M).map(([k, v]) => `<div><b>${tr(names[k])}</b> → ${escapeHtml(tr(v))}</div>`).join('');
  for (const el of $('weapon-cards').querySelectorAll('.ship')) el.addEventListener('click', async () => {
    const id = el.dataset.weapon;
    $('hangar-err').textContent = '';
    if (weaponUnlocked(id, profile.unlocks)) { weapon = id; lsSet('stardust_weapon', id); ensureAudio(); renderWeapons(); return; }
    const w = weaponById(id);
    if (profile.dust < w.cost) { $('hangar-err').textContent = `星塵不足，解鎖 ${w.name} 需要 ${w.cost}`; return; }
    try { await buyPerk('weapon:' + id); weapon = id; lsSet('stardust_weapon', id); ensureAudio(); renderHangar(); toast(`已解鎖 ${w.icon} ${w.name}`); }
    catch (e) { $('hangar-err').textContent = { 'not enough dust': '星塵不足', offline: '目前離線，無法解鎖' }[e.message] || e.message; }
  });
  $('xfer-code').value = exportCode();
}
function renderShips() {
  const cur = currentShip(), s0 = shipById(cur);
  $('ship-name').textContent = `${s0.icon} ${tr(s0.name)}`;
  const bar = (v) => { const w = Math.min(100, v * 62); return `<b><i class="${v > 1.02 ? 'hi' : v < 0.98 ? 'lo' : ''}" style="width:${w}%"></i></b>`; };
  $('ship-cards').innerHTML = SHIPS.map(s => {
    const un = shipUnlocked(s.id, profile.unlocks);
    return `<div class="ship ${s.id === cur ? 'on' : ''} ${un ? '' : 'locked'}" data-ship="${s.id}"><div class="ic">${s.icon}</div><div class="nm">${T(s.name)}</div><div class="st"><span>${tr('生命')}</span>${bar(s.stats.hp)}<span>${tr('速度')}</span>${bar(s.stats.speed)}<span>${tr('射速')}</span>${bar(s.stats.fire)}<span>${tr('傷害')}</span>${bar(s.stats.dmg)}</div><div class="ds"><span style="color:#ffd166">${escapeHtml(tr(s.trait || ''))}</span> · ${escapeHtml(tr(s.desc))}</div><div class="cost ${un ? 'ok' : ''}">${un ? (s.id === cur ? tr('✔ 出擊中') : tr('已解鎖')) : '✨ ' + s.cost}</div></div>`;
  }).join('');
  for (const el of $('ship-cards').querySelectorAll('.ship')) el.addEventListener('click', async () => {
    const id = el.dataset.ship;
    $('hangar-err').textContent = '';
    if (shipUnlocked(id, profile.unlocks)) { ship = id; lsSet('stardust_ship', id); ensureAudio(); renderShips(); renderWeapons(); return; }
    const s = shipById(id);
    if (profile.dust < s.cost) { $('hangar-err').textContent = `星塵不足，解鎖 ${s.name} 需要 ${s.cost}`; return; }
    try { await buyPerk('ship:' + id); ship = id; lsSet('stardust_ship', id); ensureAudio(); renderHangar(); toast(`已解鎖 ${s.icon} ${s.name}`); }
    catch (e) { $('hangar-err').textContent = { 'not enough dust': '星塵不足', offline: '目前離線，無法解鎖' }[e.message] || e.message; }
  });
}
function renderDust() {
  renderShips(); renderWeapons(); renderSkins(); renderSkillCards(); $('dust').textContent = '✨ ' + profile.dust.toLocaleString(); $('hangar-dust').textContent = `✨ ${tr('星塵')} ${profile.dust.toLocaleString()}（${tr('累計')} ${profile.dustTotal.toLocaleString()}）`; }

// ---------- 機庫：永久強化 ----------
function renderHangar() {
  renderDust();
  const lv = perkLevels(profile.unlocks);
  $('perk-rows').innerHTML = PERKS.map(k => {
    const l = lv[k.id] || 0, maxed = l >= k.max, cost = maxed ? 0 : k.cost[l];
    const dots = Array.from({ length: k.max }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
    return `<li><span class="ic">${k.icon}</span><span><span class="nm">${tr(k.name)}</span><span class="lv">${dots}</span><div class="ds">${tr(k.desc(Math.max(1, Math.min(k.max, l + 1))))}${l ? `（${tr('目前')}：${tr(k.desc(l))}）` : ''}</div></span><button data-perk="${k.id}" class="${maxed ? 'max' : ''}" ${maxed || profile.dust < cost ? 'disabled' : ''}>${maxed ? '已滿級' : '✨ ' + cost}</button></li>`;
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
$('open-hangar').addEventListener('click', async () => { hangarEl.hidden = false; renderHangar(); requestAnimationFrame(fitMenu); await fetchMe(); renderHangar(); requestAnimationFrame(fitMenu); });
$('hangar-close').addEventListener('click', () => { hangarEl.hidden = true; renderDust(); requestAnimationFrame(fitMenu); });
$('xfer-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('xfer-code').value); toast('已複製轉移碼'); } catch { $('xfer-code').select(); } });
$('xfer-import').addEventListener('click', async () => {
  $('hangar-err').textContent = '';
  try { const me = await importCode($('xfer-in').value); nameInput.value = me.name; lsSet('stardust_name', me.name); $('xfer-in').value = ''; renderHangar(); toast(`已切換到 ${me.name} 的帳號`); }
  catch (e) { $('hangar-err').textContent = /unauthorized|HTTP/.test(e.message) ? '轉移碼無效' : e.message; }
});

// ---------- 設定 ----------
function openSettings() {
  settingsEl.hidden = false;
  $('opt-autoaim').checked = autoAimOn(); $('opt-autofire').checked = autoFireOn();
  $('opt-music').value = getMusicVolume(); $('opt-sfx').checked = getSfxEnabled(); $('opt-lang').value = getLang();
}
$('open-settings').addEventListener('click', openSettings);
$('pause-settings').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', () => { settingsEl.hidden = true; });
$('opt-autoaim').addEventListener('change', e => { opts.autoAim = e.target.checked; saveOpts(); });
$('opt-autofire').addEventListener('change', e => { opts.autoFire = e.target.checked; saveOpts(); });
$('opt-music').addEventListener('input', e => { ensureAudio(); setMusicVolume(e.target.value); });
$('opt-sfx').addEventListener('change', e => { ensureAudio(); setSfxEnabled(e.target.checked); });
$('opt-lang').addEventListener('change', e => setLang(e.target.value));

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

// ---------- 任務 / 成就 / 圖鑑 ----------
let metaCache = null;
async function loadMeta() { const m = await fetchMeta(); if (m) metaCache = m; return metaCache; }
function questRow(q, prog, done) {
  const v = Math.min(q.goal, prog || 0), pct = Math.round(100 * v / q.goal);
  return `<li class="${done ? '' : ''}"><span class="ic">${q.icon}</span><span><span class="nm">${escapeHtml(tr(q.name))}</span><div class="ds">${escapeHtml(tr(q.desc).replace('{n}', q.goal))}</div><div class="bar"><i class="${done ? 'done' : ''}" style="width:${done ? 100 : pct}%"></i></div></span><span class="st ${done ? 'done' : ''}">${done ? tr('✔ 完成') : `${v} / ${q.goal}`}<br>✨ ${q.dust}</span></li>`;
}
async function openQuests() {
  questsEl.hidden = false;
  $('quests-sub').textContent = tr('載入中…');
  const m = await loadMeta();
  if (!m) { $('quests-sub').textContent = tr('無法連線到伺服器'); return; }
  const meta = m.meta || {}, d = meta.daily && meta.daily.key === m.day ? meta.daily : { prog: {}, done: [] }, w = meta.weekly && meta.weekly.key === m.week ? meta.weekly : { prog: {}, done: [] };
  $('quests-sub').textContent = tr(`每日任務每天換一組（${m.day}），每週任務跨局累計（週一重置，本週 ${m.week}）。完成直接拿星塵。`);
  $('quests-daily-title').textContent = `${tr('每日任務')} · ${m.day}`; $('quests-weekly-title').textContent = tr(`每週任務 · ${m.week} 起`);
  $('quests-daily').innerHTML = dailyQuests(m.day).map(q => questRow(q, d.prog[q.id], d.done.includes(q.id))).join('');
  $('quests-weekly').innerHTML = weeklyQuests(m.week).map(q => questRow(q, w.prog[q.id], w.done.includes(q.id))).join('');
}
async function openAch() {
  achEl.hidden = false;
  const m = await loadMeta();
  const got = new Set((m && m.meta && m.meta.ach) || []);
  $('ach-sub').textContent = `${tr('已解鎖')} ${got.size} / ${ACHIEVEMENTS.length}${m ? '' : tr('（離線：顯示上次快取）')}`;
  $('ach-rows').innerHTML = ACHIEVEMENTS.map(a => `<li class="${got.has(a.id) ? '' : 'locked'}"><span class="ic">${a.icon}</span><span><span class="nm">${escapeHtml(tr(a.name))}</span><div class="ds">${escapeHtml(tr(a.desc))}</div></span><span class="st ${got.has(a.id) ? 'done' : ''}">${got.has(a.id) ? tr('✔ 已解鎖') : '✨ ' + a.dust}</span></li>`).join('');
}
let codexTab = 'enemies';
async function openCodex() {
  codexEl.hidden = false;
  const m = await loadMeta();
  const seen = (m && m.meta && m.meta.prog && m.meta.prog.seen) || { enemies: {}, bosses: {}, events: {} };
  const arenasProg = (m && m.meta && m.meta.prog && m.meta.prog.arenas) || {};
  for (const b of codexEl.querySelectorAll('[data-codex]')) b.classList.toggle('on', b.dataset.codex === codexTab);
  const body = $('codex-body');
  if (codexTab === 'enemies') {
    const list = Object.entries(ENEMY_TYPES).filter(([k]) => k !== 'rock');
    $('codex-sub').textContent = tr(`見過 ${list.filter(([k]) => seen.enemies[k]).length} / ${list.length} 種敵人（打過就會記錄）`);
    body.innerHTML = `<div class="grid">${list.map(([k, t]) => `<div class="card ${seen.enemies[k] ? '' : 'unseen'}"><div class="nm" style="color:${t.color}">${seen.enemies[k] ? escapeHtml(tr(t.name)) : '？？？'} ${t.element ? ELEMENTS[t.element].icon : ''}</div><div class="ds">${seen.enemies[k] ? escapeHtml(tr(t.atk)) : tr('尚未遭遇')}</div></div>`).join('')}</div>`;
  } else if (codexTab === 'bosses') {
    const list = Object.entries(BOSS_KINDS);
    $('codex-sub').textContent = tr(`遭遇過 ${list.filter(([k]) => seen.bosses[k]).length} / ${list.length} 種 Boss`);
    body.innerHTML = `<div class="grid">${list.map(([k, b]) => `<div class="card ${seen.bosses[k] ? '' : 'unseen'}"><div class="nm" style="color:${b.color}">${seen.bosses[k] ? escapeHtml(tr(b.name)) : '？？？'}</div><div class="ds">${seen.bosses[k] ? escapeHtml(tr(b.desc)) : tr('尚未遭遇')}</div></div>`).join('')}</div>`;
  } else if (codexTab === 'arenas') {
    $('codex-sub').textContent = tr('每個場地的最佳波次');
    body.innerHTML = `<div class="grid">${ARENAS.map(a => `<div class="card"><div class="nm">${a.icon} ${escapeHtml(tr(a.name))} <span style="color:#ffd166">${arenasProg[a.id] ? tr(`最佳第 ${arenasProg[a.id]} 波`) : tr('未挑戰')}</span></div><div class="ds">${escapeHtml(tr(a.desc))}。${escapeHtml(tr(a.hazard))}。${tr('原生生物')}：${escapeHtml(tr(ENEMY_TYPES[a.unique].name))}</div></div>`).join('')}</div>`;
  } else if (codexTab === 'events') {
    const list = Object.entries(EVENTS);
    $('codex-sub').textContent = tr(`遇過 ${list.filter(([k]) => seen.events[k]).length} / ${list.length} 種隨機事件`);
    body.innerHTML = `<div class="grid">${list.map(([k, e]) => `<div class="card ${seen.events[k] ? '' : 'unseen'}"><div class="nm">${e.icon} ${seen.events[k] ? escapeHtml(tr(e.name)) : '？？？'}</div><div class="ds">${seen.events[k] ? escapeHtml(tr(e.desc)) : tr('尚未遭遇')}</div></div>`).join('')}</div>`;
  } else {
    const wel = ['kinetic', 'fire', 'ice', 'plasma', 'light'], wname = { kinetic: '動能（脈衝砲 / 光刃）', fire: '火焰槍', ice: '冰凍光線', plasma: '閃電鏈', light: '雷射砲' };
    $('codex-sub').textContent = tr('敵人屬性 × 武器屬性 = 傷害倍率（綠色有效、紅色被抵抗）');
    body.innerHTML = `<table><tr><th></th>${wel.map(w => `<th>${escapeHtml(tr(wname[w]))}</th>`).join('')}</tr>${Object.keys(ELEMENTS).map(el => `<tr><th style="color:${ELEMENTS[el].color}">${ELEMENTS[el].icon} ${escapeHtml(tr(ELEMENTS[el].name))}</th>${wel.map(w => { const v = (AFFINITY[el] || {})[w] ?? 1; return `<td class="${v > 1 ? 'hi' : v < 1 ? 'lo' : ''}">×${v}</td>`; }).join('')}</tr>`).join('')}</table>`;
  }
}
$('open-quests').addEventListener('click', openQuests); $('quests-close').addEventListener('click', () => { questsEl.hidden = true; });
$('open-ach').addEventListener('click', openAch); $('ach-close').addEventListener('click', () => { achEl.hidden = true; });
$('open-codex').addEventListener('click', openCodex); $('codex-close').addEventListener('click', () => { codexEl.hidden = true; });
for (const b of codexEl.querySelectorAll('[data-codex]')) b.addEventListener('click', () => { codexTab = b.dataset.codex; openCodex(); });

/** 一局結束：把統計送給伺服器算任務 / 成就，並提示 */
async function reportMeta() {
  if (metaReported) return;
  metaReported = true;
  if (mode === 'online' || leftTeam) return;   // 合作局由伺服器用自己的統計算，隨 result 訊息回來（announceMeta）
  const p = me() || {};
  const summary = runSummary(world, { coop: false, ship: p.ship || currentShip(), weapon: p.weapon || currentWeapon() });
  const r = await reportRun(summary);
  if (!r) return;
  announceMeta(r);
}
function announceMeta(r) {
  renderDust();
  let delay = 0;
  for (const id of r.ach) { const a = ACHIEVEMENTS.find(x => x.id === id); if (a) setTimeout(() => { toast(`成就解鎖 ${a.icon} ${a.name} · ✨ +${a.dust}`, 4000); fx.sfx('wave'); }, delay); delay += 4200; }
  for (const key of r.quests) { const q = QUESTS.find(x => x.id === key.split(':')[1]); if (q) setTimeout(() => toast(`任務完成 ${q.icon} ${q.name} · ✨ +${key.startsWith('week') ? q.dust * 3 : q.dust}`, 3500), delay), delay += 3700; }
}

// ---------- 連線 ----------
function beginOnline(code) {
  ensureAudio(); goFullscreen();
  const name = takeName();
  errEl.textContent = '連線中…';
  net = connect({
    name, code, acct: accountCredentials(), ship: currentShip(), weapon: currentWeapon(), skin: currentSkin(), skill: currentSkill(),
    onWelcome(m) {
      mode = 'online'; myId = m.id; fx = createFx(myId);
      resetEffects(); predictor.reset(); lastSnapSeen = -1; metaReported = false;
      for (const el of OVERLAYS) el.hidden = true;
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
      hostId = m.hostId; roomArena = m.arena || 'space'; roomPublic = !!m.public;
      $('lobby-players').innerHTML = m.players.map(p => `<li style="color:${p.color}">${p.id === m.hostId ? '👑 ' : ''}${shipById(p.ship).icon} ${escapeHtml(p.name)}${p.id === myId ? '（你）' : ''}</li>`).join('');
      const host = m.hostId === myId;
      $('lobby-start').hidden = !host; $('lobby-boss-row').hidden = !host; $('lobby-public-row').hidden = !host;
      $('lobby-public').checked = roomPublic;
      $('lobby-wait').hidden = host;
      $('lobby-start').textContent = tr(m.players.length === 1 ? '單獨出擊（可等朋友加入）' : `全員出擊（${m.players.length} 人）`);
      renderArenas($('lobby-arena'), roomArena, id => net?.send({ t: 'arena', id }), !host);
      if (m.scene === 'lobby' && world.scene !== 'play') { lobbyEl.hidden = false; world.scene = 'menu'; }
    },
    onStarted() { runStartedAt = performance.now(); track('run_start', { mode: 'coop', ship: currentShip(), weapon: currentWeapon(), arena: roomArena }); resetEffects(); predictor.reset(); lastSnapSeen = -1; lastResult = null; leftTeam = false; metaReported = false; lobbyEl.hidden = true; pauseEl.hidden = true; world.scene = 'play'; },
    onResult(m) { const mb = m.metaBy?.[getAccount()?.id]; if (mb) { if (mb.dust) { profile.dust += mb.dust; profile.dustTotal += mb.dust; } setTimeout(() => announceMeta(mb), 4200); fetchMeta(); } const d = m.dustBy?.[getAccount()?.id] || 0; if (d) { profile.dust += d; profile.dustTotal += d; } lastResult = { rank: m.rank, mode: 'coop', dust: d }; toast(`${m.rank ? `合作排行榜 第 ${m.rank} 名 · ` : ''}星塵 +${d}`, 4000); },
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
$('lobby-public').addEventListener('change', e => net?.send({ t: 'public', on: e.target.checked }));
$('lobby-leave').addEventListener('click', () => showMenu());
$('copy-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('room-link').href); $('copy-link').textContent = '已複製！'; setTimeout(() => $('copy-link').textContent = '複製邀請連結', 1500); } catch {} });
for (const el of [nameInput, codeInput]) el.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') { if (el === codeInput && codeInput.value.trim()) $('join').click(); else beginSolo(0); }
});
// 快速配對 / 公開房間
async function doQuickMatch() {
  errEl.textContent = '尋找隊友中…';
  try { const r = await quickMatch(); roomsEl.hidden = true; beginOnline(r.code); if (r.created) toast('開了一間公開房間，等其他玩家配對進來；你也可以直接出擊', 4000); else toast('找到隊友，加入房間！'); }
  catch (e) { errEl.textContent = '快速配對失敗：' + e.message; }
}
$('quick').addEventListener('click', doQuickMatch);
$('rooms-quick').addEventListener('click', doQuickMatch);
async function openRooms() {
  roomsEl.hidden = false;
  $('rooms-status').textContent = '載入中…'; $('rooms-rows').innerHTML = '';
  try {
    const r = await fetchRooms();
    if (!r.rooms.length) { $('rooms-status').textContent = '目前沒有公開房間。用「快速配對」開一間，或建立房間後在大廳勾「公開房間」。'; return; }
    $('rooms-status').textContent = `${r.rooms.length} 間公開房間在等人`;
    $('rooms-rows').innerHTML = r.rooms.map(x => { const A = arenaById(x.arena); return `<li class="room"><span class="rk">${x.code}</span><span class="nm">${escapeHtml(x.host || '')} · ${A.icon} ${tr(A.name)}</span><span class="wv">${x.players} / ${x.max}</span><button data-code="${x.code}">加入</button></li>`; }).join('');
    for (const b of $('rooms-rows').querySelectorAll('button[data-code]')) b.addEventListener('click', () => { roomsEl.hidden = true; beginOnline(b.dataset.code); });
  } catch (e) { $('rooms-status').textContent = '無法載入：' + e.message; }
}
$('open-rooms').addEventListener('click', openRooms);
$('rooms-refresh').addEventListener('click', openRooms);
$('rooms-close').addEventListener('click', () => { roomsEl.hidden = true; });

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
  rows.innerHTML = `<li class="muted">${T('載入中…')}</li>`;
  try {
    const [data, meData] = await Promise.all([fetchLeaderboard(lb.mode, lb.period), fetchMe()]);
    const myAcct = getAccount()?.id;
    const st = meData?.stats?.[lb.mode];
    if (lb.mode === 'daily') meEl.textContent = `今日挑戰（${data.day}）· 每人一次`;
    else meEl.textContent = (st ? `你的最佳：${st.best} 分（第 ${st.bestWave} 波）· 全部時間第 ${st.rank} 名 · 共 ${st.runs} 局` : '還沒有成績，去打一局吧！') + (lb.period === 'week' ? ` · 週榜每週一（台灣時間）重置，本週 ${weekKey()} 起` : '');
    renderDust();
    if (!data.rows.length) { rows.innerHTML = '<li class="muted">還沒有人上榜，第一名就是你</li>'; return; }
    rows.innerHTML = data.rows.map((r, i) => {
      const mine = myAcct && r.party.some(p => p.id === myAcct);
      const names = r.party.map(p => escapeHtml(p.name)).join(' + ');
      return `<li class="${i < 3 ? 'top' + (i + 1) : ''}${mine ? ' me' : ''}"><span class="rk">#${i + 1}</span><span class="nm">${names}${lb.mode === 'coop' ? ` <small>${r.party.length} 人</small>` : ''}</span><span class="sc">${r.score.toLocaleString()}</span><span class="wv">${tr(`第 ${r.wave} 波`)}</span></li>`;
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
  if (mode === 'solo') { if (world.scene === 'play') togglePause(world); $('pause-title').textContent = tr('暫停'); $('pause-sub').textContent = tr('單人模式已暫停'); }
  else { $('pause-title').textContent = tr('選單'); $('pause-sub').textContent = tr('多人模式不會暫停，隊友仍在戰鬥'); }
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
  return { mode: runKind, ship: p.ship || currentShip(), weapon: p.weapon || currentWeapon(), arena: world.arena, wave: world.wave, score: world.score, reason, dur: Math.round((performance.now() - runStartedAt) / 1000), kills: p.kills || 0, ups: Object.keys(p.upgrades || {}), syn: Object.keys(p.syn || {}), evolved: world.stats?.evolved || null, killedBy: world.stats?.killedBy || null, events: world.stats?.events || [] };
}
function finishSoloRun() {
  if (soloSubmitted) return;
  soloSubmitted = true;
  track('run_end', runEndProps(world.abandoned ? 'abandon' : world.won ? (world.endless ? 'endless' : 'victory') : 'dead'));
  if (world.score > best) { best = world.score; lsSet('stardust_best', String(best)); }
  const kind = runKind, day = dailyInfo?.key || null;
  submitRun(world.score, world.wave, { mode: kind, day, dustBonus: world.dustBonus || 0 }).then(r => {
    if (!r) return;
    lastResult = { rank: r.rank, mode: kind, dust: r.dust };
    renderDust();
    toast(`${tr(kind === 'daily' ? '今日挑戰' : '單人排行榜')}${r.rank ? ' ' + tr(`第 ${r.rank} 名`) : ''} · ${tr(`星塵 +${r.dust}`)}${r.bonus ? ` (${tr(`含 ${r.bonus} 星塵碎片`)})` : ''}`, 4000);
  });
  reportMeta();
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
  track('run_end', { ...runEndProps('left'), mode: 'coop' });
  predictor.reset();
  world.scene = 'gameover'; world.abandoned = true; leftTeam = true; lastResult = null;
  history.replaceState(null, '', location.pathname);
  fx.sfx('gameover');
  reportMeta();
}

// ---------- 輸入 ----------
attachInput(canvas, renderer.toWorld, {
  onKeyDown(code) {
    if (!menuEl.hidden || !lobbyEl.hidden) { if (code === 'Escape') { for (const el of OVERLAYS) if (el !== menuEl && el !== lobbyEl && !el.hidden) { el.hidden = true; break; } } return; }
    if (code === 'Escape') {
      if (!lbEl.hidden) { lbEl.hidden = true; return; }
      if (!settingsEl.hidden) { settingsEl.hidden = true; return; }
      if (world.scene === 'victory') { victoryChoice(false); return; }
      if (!pauseEl.hidden) closePause();
      else if (world.scene === 'gameover') showMenu();
      else openPause();
      return;
    }
    if (overlayOpen()) return;
    if (code === 'KeyL' && world.scene === 'gameover') { lb.mode = leftTeam || mode === 'online' ? 'coop' : runKind; openLeaderboard(); return; }
    if (code === 'KeyM') toggleMute();
    if (code === 'KeyP' && mode === 'solo') { if (world.scene === 'pause') closePause(); else openPause(); }
    if (world.scene === 'victory') { if (code === 'Enter') victoryChoice(true); return; }
    if (code === 'Enter' && world.scene === 'gameover') { if (leftTeam || runKind === 'daily') showMenu(); else if (mode === 'solo') beginSolo(0); else if (hostId === myId) net?.start($('lobby-boss').checked); }
    if (world.scene === 'upgrade') {
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2, Digit0: -1, Numpad0: -1 }[code];
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
      if (i >= 0) { pickUpgrade(i); return; }
      const sk = renderer.skipRect();
      if (mouse.x >= sk.x && mouse.x <= sk.x + sk.w && mouse.y >= sk.y && mouse.y <= sk.y + sk.h) pickUpgrade(-1);
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
  const c = i >= 0 ? world.pendingUpgrades.get(myId)?.[i] : null; if (c) track('upgrade', { id: c.id, wave: world.wave }); else if (i === -1) track('upgrade', { id: 'skip', wave: world.wave });
  if (mode === 'solo') chooseUpgrade(world, myId, i, fx);
  else net?.chooseUpgrade(i);
}

// ---------- 主迴圈 ----------
window.addEventListener('resize', renderer.resize);
renderer.resize();
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  try { frame(now); } catch (e) { if (!loop.errCount) loop.errCount = 0; if (loop.errCount++ < 3) console.error('frame error', e); }
}
function frame(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000); last = now;
  uiTime += rawDt; trackFrame((now - last + rawDt * 1000) / 1000);
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
    if (prevScene !== 'gameover' && world.scene === 'gameover') { if (world.score > best) { best = world.score; lsSet('stardust_best', String(best)); } track('run_end', { ...runEndProps(world.won ? 'victory' : 'dead'), mode: 'coop' }); reportMeta(); }
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
  setMood(world.scene === 'menu' || !menuEl.hidden ? 'menu' : world.scene === 'gameover' || world.scene === 'victory' ? 'over' : (world.bosses && world.bosses.length) || world.bossWarn > 0 ? 'boss' : 'play');
  renderer.draw({ time: uiTime, mouse, me: me(), best, muted: isMuted(), online: mode === 'online', isHost: hostId === myId, result: lastResult, left: leftTeam, daily: runKind === 'daily', arena });
}
showMenu();
if (codeInput.value) $('join').click(); // 用邀請連結進來：自動加入
requestAnimationFrame(loop);

// PWA：可安裝、離線也能開單人
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// 除錯 / 自動測試用
window.__dbg = () => ({ world, vfx, me: me(), mode, net, predictor, hostId, arena });
