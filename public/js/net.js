// 客戶端連線：送輸入、收快照與事件、做插值。
import { applySnapshot } from '../../shared/snapshot.js';
import { TICK_RATE } from '../../shared/constants.js';

const INTERP_DELAY = 2 * (1000 / TICK_RATE); // 落後兩個 tick 渲染，吸收網路抖動

export function connect({ name, code, boss, onWelcome, onLobby, onStarted, onError, onClose }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  const net = {
    ws, id: null, code: null, connected: false,
    prev: null, curr: null, tPrev: 0, tCurr: 0, pendingEvents: [],
    send(m) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    sendInput(inp) { net.send({ t: 'input', ...inp }); },
    chooseUpgrade(idx) { net.send({ t: 'upgrade', idx }); },
    start() { net.send({ t: 'start' }); },
    close() { try { ws.close(); } catch {} },
    /** 每幀呼叫：把插值後的狀態寫進 world，並回傳這幀要播放的 fx 事件 */
    applyTo(world, now) {
      if (!net.curr) return [];
      let t = 1;
      if (net.prev && net.tCurr > net.tPrev) t = Math.max(0, Math.min(1, (now - INTERP_DELAY - net.tPrev) / (net.tCurr - net.tPrev)));
      applySnapshot(world, net.prev, net.curr, t);
      const ev = net.pendingEvents; net.pendingEvents = [];
      return ev;
    },
  };
  ws.addEventListener('open', () => { net.connected = true; ws.send(JSON.stringify({ t: 'join', name, code, boss })); });
  ws.addEventListener('message', e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    switch (m.t) {
      case 'welcome': net.id = m.id; net.code = m.code; onWelcome?.(m); break;
      case 'lobby': onLobby?.(m); break;
      case 'started': net.prev = net.curr = null; onStarted?.(m); break;
      case 'snap':
        net.prev = net.curr; net.tPrev = net.tCurr;
        net.curr = m.s; net.tCurr = performance.now();
        if (m.ev) net.pendingEvents.push(...m.ev);
        break;
      case 'error': onError?.(m.msg); break;
    }
  });
  ws.addEventListener('close', () => { net.connected = false; onClose?.(); });
  ws.addEventListener('error', () => { onError?.('無法連線到伺服器'); });
  return net;
}

/** 播放伺服器送來的 fx 事件；pid 不為 null 且不是自己的就略過（只對本機的效果） */
export function playEvents(events, fx, myId) {
  for (const [name, pid, args] of events) {
    if (pid !== null && pid !== myId) continue;
    const f = fx[name];
    if (typeof f === 'function') f(...args);
  }
}
