// 輸入：鍵盤與滑鼠。滑鼠座標會透過 view 轉成世界座標，讓不同螢幕比例下的瞄準一致。
export const keys = {};
export const mouse = { x: 0, y: 0, sx: 0, sy: 0, down: false };

/**
 * @param canvas    遊戲畫布
 * @param toWorld   (screenX, screenY) => {x, y} 轉世界座標
 * @param handlers  { onKeyDown(code, event), onMouseDown(button, event) }
 */
export function attachInput(canvas, toWorld, handlers) {
  const updateMouse = e => {
    const r = canvas.getBoundingClientRect();
    mouse.sx = e.clientX - r.left; mouse.sy = e.clientY - r.top;
    const w = toWorld(mouse.sx, mouse.sy); mouse.x = w.x; mouse.y = w.y;
  };
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && e.target === document.body) e.preventDefault();
    handlers.onKeyDown?.(e.code, e);
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; mouse.down = false; handlers.onBlur?.(); });
  canvas.addEventListener('mousemove', updateMouse);
  canvas.addEventListener('mousedown', e => { updateMouse(e); if (e.button === 0) mouse.down = true; handlers.onMouseDown?.(e.button, e); });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

/** 由目前鍵盤滑鼠狀態組出玩家輸入（未來直接序列化送給伺服器） */
export function buildInput(player) {
  let ix = 0, iy = 0;
  if (keys.KeyW || keys.ArrowUp) iy -= 1;
  if (keys.KeyS || keys.ArrowDown) iy += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  return {
    ix, iy,
    angle: Math.atan2(mouse.y - player.y, mouse.x - player.x),
    fire: mouse.down,
    dash: !!(keys.ShiftLeft || keys.ShiftRight || keys.Space),
  };
}
