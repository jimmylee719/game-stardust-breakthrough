// 輸入：鍵盤滑鼠 + 觸控（虛擬雙搖桿）。
// 觸控配置：左半螢幕拖曳 = 移動搖桿；右半螢幕拖曳 = 瞄準並開火；右下圓鈕 = 衝刺；右上圓鈕 = 選單。
// 右邊沒按時自動瞄準最近的敵人並自動開火，讓手機也能輕鬆玩。
import { nearestTarget } from './game.js';

export const keys = {};
/** 玩家選項：autoAim / autoFire（null = 依裝置預設：觸控開、電腦關） */
export const opts = { autoAim: null, autoFire: null };
try { Object.assign(opts, JSON.parse(localStorage.getItem('stardust_opts') || '{}')); } catch {}
export function saveOpts() { try { localStorage.setItem('stardust_opts', JSON.stringify(opts)); } catch {} }
export function autoAimOn() { return opts.autoAim === null ? touch.active || matchMedia('(pointer: coarse)').matches : !!opts.autoAim; }
export function autoFireOn() { return opts.autoFire === null ? touch.active || matchMedia('(pointer: coarse)').matches : !!opts.autoFire; }
export const mouse = { x: 0, y: 0, sx: 0, sy: 0, down: false };
/** 觸控狀態（渲染用來畫搖桿與按鈕） */
export const touch = {
  active: false,                 // 曾經偵測到觸控 → 切換成觸控模式
  move: null,                    // { id, ox, oy, x, y, dx, dy, mag }  螢幕座標
  aim: null,                     // 同上
  dash: false, dashId: null, blink: false, blinkId: null,
  autoAngle: null,               // 自動瞄準的角度（給渲染畫提示）
};
const STICK_R = 64;              // 搖桿最大半徑（CSS px）
const DEAD = 0.12;

/** 螢幕上的按鈕位置（螢幕 CSS px），輸入與渲染共用 */
export function touchLayout(cw, ch) {
  return {
    dash: { x: cw - 86, y: ch - 86, r: 44 },
    blink: { x: cw - 176, y: ch - 70, r: 36 },
    menu: { x: cw - 34, y: 34, r: 24 },
  };
}
const inCircle = (x, y, c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r ** 2;

/**
 * @param canvas    遊戲畫布
 * @param toWorld   (screenX, screenY) => {x, y} 轉世界座標
 * @param handlers  { onKeyDown(code, event), onMouseDown(button, event), onBlur(), onMenuTap() }
 */
export function attachInput(canvas, toWorld, handlers) {
  const updateMouse = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    mouse.sx = cx - r.left; mouse.sy = cy - r.top;
    const w = toWorld(mouse.sx, mouse.sy); mouse.x = w.x; mouse.y = w.y;
  };
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && e.target === document.body) e.preventDefault();
    handlers.onKeyDown?.(e.code, e);
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; mouse.down = false; touch.move = touch.aim = null; touch.dash = false; handlers.onBlur?.(); });
  canvas.addEventListener('mousemove', e => updateMouse(e.clientX, e.clientY));
  canvas.addEventListener('mousedown', e => { updateMouse(e.clientX, e.clientY); if (e.button === 0) mouse.down = true; handlers.onMouseDown?.(e.button, e); });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- 觸控 ----------
  const rectOf = () => canvas.getBoundingClientRect();
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    touch.active = true;
    const r = rectOf();
    const cw = r.width, ch = r.height, L = touchLayout(cw, ch);
    // 保險：若之前的 touchend 沒收到（系統手勢、彈窗），把已不存在的手指清掉，避免搖桿卡住
    const live = new Set([...e.touches].map(t => t.identifier));
    if (touch.move && !live.has(touch.move.id)) touch.move = null;
    if (touch.aim && !live.has(touch.aim.id)) touch.aim = null;
    if (touch.dashId !== null && !live.has(touch.dashId)) { touch.dash = false; touch.dashId = null; }
    if (touch.blinkId !== null && !live.has(touch.blinkId)) { touch.blink = false; touch.blinkId = null; }
    for (const t of e.changedTouches) {
      const x = t.clientX - r.left, y = t.clientY - r.top;
      if (inCircle(x, y, L.menu)) { handlers.onMenuTap?.(); continue; }
      if (inCircle(x, y, L.dash)) { touch.dash = true; touch.dashId = t.identifier; continue; }
      if (inCircle(x, y, L.blink)) { touch.blink = true; touch.blinkId = t.identifier; continue; }
      // 非遊戲場景（升級卡、結算）：當成點擊
      if (handlers.isTapScene?.()) { updateMouse(t.clientX, t.clientY); handlers.onMouseDown?.(0, e); continue; }
      const stick = { id: t.identifier, ox: x, oy: y, x, y, dx: 0, dy: 0, mag: 0 };
      if (x < cw / 2) { if (!touch.move) touch.move = stick; }
      else if (!touch.aim) touch.aim = stick;
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const r = rectOf();
    for (const t of e.changedTouches) {
      const x = t.clientX - r.left, y = t.clientY - r.top;
      for (const s of [touch.move, touch.aim]) {
        if (!s || s.id !== t.identifier) continue;
        let dx = x - s.ox, dy = y - s.oy;
        const d = Math.hypot(dx, dy);
        if (d > STICK_R) { dx = dx / d * STICK_R; dy = dy / d * STICK_R; }
        s.x = s.ox + dx; s.y = s.oy + dy; s.dx = dx / STICK_R; s.dy = dy / STICK_R; s.mag = Math.min(1, d / STICK_R);
      }
    }
  }, { passive: false });
  const end = e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (touch.move && touch.move.id === t.identifier) touch.move = null;
      if (touch.aim && touch.aim.id === t.identifier) touch.aim = null;
      if (touch.dashId === t.identifier) { touch.dash = false; touch.dashId = null; }
      if (touch.blinkId === t.identifier) { touch.blinkId = null; }
    }
  };
  canvas.addEventListener('touchend', end, { passive: false });
  canvas.addEventListener('touchcancel', end, { passive: false });
}

/** 由目前輸入狀態組出玩家輸入（連線時直接序列化送伺服器） */
export function buildInput(player, world) {
  if (touch.active) {
    const m = touch.move;
    const ix = m && m.mag > DEAD ? m.dx : 0, iy = m && m.mag > DEAD ? m.dy : 0;
    let angle = player.angle, fire = false;
    if (touch.aim && touch.aim.mag > DEAD) { angle = Math.atan2(touch.aim.dy, touch.aim.dx); fire = true; touch.autoAngle = null; }
    else {
      const t = world && autoAimOn() ? nearestTarget(world, player.x, player.y, 1400) : null;
      if (t) { angle = Math.atan2(t.y - player.y, t.x - player.x); fire = autoFireOn(); touch.autoAngle = angle; }
      else touch.autoAngle = null;
      if (touch.aim) fire = true;   // 手指按著但沒拖：朝目前方向開火
    }
    const dash = touch.dash; touch.dash = false;   // 衝刺當作一次性按下
    const blink = touch.blink; touch.blink = false;
    return { ix, iy, angle, fire, dash, blink };
  }
  let ix = 0, iy = 0;
  if (keys.KeyW || keys.ArrowUp) iy -= 1;
  if (keys.KeyS || keys.ArrowDown) iy += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  let angle = Math.atan2(mouse.y - player.y, mouse.x - player.x), fire = mouse.down;
  // 電腦也可以開自動瞄準 / 自動射擊（設定）
  if (world && (autoAimOn() || autoFireOn())) {
    const t = nearestTarget(world, player.x, player.y, 1400);
    if (t) { if (autoAimOn() && !mouse.down) angle = Math.atan2(t.y - player.y, t.x - player.x); if (autoFireOn()) fire = true; }
  }
  return {
    ix, iy, angle, fire,
    dash: !!(keys.ShiftLeft || keys.ShiftRight),
    blink: !!keys.Space,
  };
}
