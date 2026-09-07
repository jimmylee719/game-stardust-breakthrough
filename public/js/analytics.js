// 遊玩事件記錄（客戶端）：只記匿名帳號 id 與遊玩行為，不記任何個人資料。
// 事件先排隊，每 8 秒或離開頁面時用 sendBeacon 一次送出，不影響遊戲效能。
import { getAccount } from './account.js';

const sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let queue = [];
let timer = null;

export function track(name, props = {}) {
  queue.push({ name, props, t: Date.now(), acct: getAccount()?.id || null });
  if (queue.length >= 25) flush();
  else if (!timer) timer = setTimeout(flush, 8000);
}
export function flush() {
  clearTimeout(timer); timer = null;
  if (!queue.length) return;
  const body = JSON.stringify({ sid, events: queue.splice(0, 50) });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }))) return;
  } catch {}
  fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

track('session', { device: matchMedia('(pointer: coarse)').matches ? 'touch' : 'desktop', w: innerWidth, h: innerHeight });
