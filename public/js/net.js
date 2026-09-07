// 客戶端連線：送輸入、收快照與事件、做插值、斷線自動重連。
import { applySnapshot } from '../../shared/snapshot.js';
import { TICK_RATE } from '../../shared/constants.js';

const INTERP_DELAY = 2 * (1000 / TICK_RATE); // 落後兩個 tick 渲染，吸收網路抖動
const RECONNECT_WINDOW = 12000;               // 斷線後嘗試重連的時間（伺服器保留角色 15 秒）

export function connect({ name, code, token, onWelcome, onLobby, onStarted, onError, onClose, onReconnecting }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const net = {
    ws: null, id: null, code: code || null, token: token || null, connected: false, closedByUser: false,
    prev: null, curr: null, tPrev: 0, tCurr: 0, pendingEvents: [], snapCount: 0,
    send(m) { if (net.ws && net.ws.readyState === WebSocket.OPEN) net.ws.send(JSON.stringify(m)); },
    sendInput(inp) { net.send({ t: 'input', ...inp }); },
    chooseUpgrade(idx) { net.send({ t: 'upgrade', idx }); },
    start(boss = false) { net.send({ t: 'start', boss }); },
    close() { net.closedByUser = true; try { net.ws?.close(); } catch {} },
    applyTo(world, now) {
      if (!net.curr) return [];
      let t = 1;
      if (net.prev && net.tCurr > net.tPrev) t = Math.max(0, Math.min(1, (now - INTERP_DELAY - net.tPrev) / (net.tCurr - net.tPrev)));
      applySnapshot(world, net.prev, net.curr, t);
      const ev = net.pendingEvents; net.pendingEvents = [];
      return ev;
    },
  };

  let hadWelcome = false, reconnectUntil = 0;
  function open() {
    const ws = new WebSocket(`${proto}://${location.host}`);
    net.ws = ws;
    ws.addEventListener('open', () => { net.connected = true; ws.send(JSON.stringify({ t: 'join', name, code: net.code, token: net.token })); });
    ws.addEventListener('message', e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      switch (m.t) {
        case 'welcome':
          net.id = m.id; net.code = m.code; net.token = m.token;
          net.prev = net.curr = null; net.snapCount = 0;
          hadWelcome = true; reconnectUntil = 0;
          onWelcome?.(m); break;
        case 'lobby': onLobby?.(m); break;
        case 'started': net.prev = net.curr = null; net.snapCount = 0; onStarted?.(m); break;
        case 'snap':
          net.prev = net.curr; net.tPrev = net.tCurr;
          net.curr = m.s; net.tCurr = performance.now(); net.snapCount++;
          if (m.ev) net.pendingEvents.push(...m.ev);
          break;
        case 'error': reconnectUntil = 0; onError?.(m.msg); break;
      }
    });
    ws.addEventListener('close', () => {
      net.connected = false;
      if (net.closedByUser) { onClose?.(); return; }
      // 曾成功加入且有 token → 在時間窗內自動重連
      if (hadWelcome && net.token) {
        if (!reconnectUntil) reconnectUntil = performance.now() + RECONNECT_WINDOW;
        if (performance.now() < reconnectUntil) { onReconnecting?.(); setTimeout(open, 1000); return; }
      }
      onClose?.();
    });
    ws.addEventListener('error', () => { if (!hadWelcome) onError?.('無法連線到伺服器'); });
  }
  open();
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
