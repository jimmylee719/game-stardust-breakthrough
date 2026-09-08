// 客戶端預測：本機玩家的移動先在本機用與伺服器相同的 stepPlayer 算，
// 收到伺服器快照時以權威狀態為準，重播尚未被伺服器處理的輸入，
// 差異用平滑偏移吸收，避免畫面跳動。
import { stepPlayer, NULL_FX } from './game.js';
import { TICK_RATE } from '../../shared/constants.js';

const TICK_DT = 1 / TICK_RATE;
const FIELDS = ['x', 'y', 'vx', 'vy', 'dashing', 'dashCd', 'inv', 'r', 'speedMul', 'dashCdMax', 'color', 'blinkCd', 'blinkCdMax'];

export function createPredictor(world) {
  const st = { x: 0, y: 0, vx: 0, vy: 0, dashing: 0, dashCd: 0, inv: 0, r: 14, speedMul: 1, dashCdMax: 1.2, color: '#fff', angle: 0, blinkCd: 0, blinkCdMax: 3, blinkFlash: 0 };
  let seq = 0, acc = 0, pending = [], lastAck = -1, smoothX = 0, smoothY = 0, ready = false;

  return {
    get state() { return st; },
    get pendingCount() { return pending.length; },
    reset() { seq = 0; acc = 0; pending = []; lastAck = -1; smoothX = smoothY = 0; ready = false; },

    /** 每幀：以固定 tick 產生輸入並本機模擬。回傳這幀要送給伺服器的輸入陣列。 */
    step(rawDt, buildInput) {
      if (!ready) return [];
      const out = [];
      acc += rawDt;
      let guard = 0;
      while (acc >= TICK_DT && guard++ < 4) {
        const input = buildInput(st);
        seq++;
        stepPlayer(world, st, input, TICK_DT, NULL_FX);
        pending.push({ seq, input });
        out.push({ ...input, seq });
        acc -= TICK_DT;
      }
      st.angle = buildInput(st).angle; // 瞄準角即時反映，不等 tick
      // 平滑偏移隨時間衰減（約 0.1 秒收斂）
      const k = Math.pow(0.001, rawDt / 0.1);
      smoothX *= k; smoothY *= k;
      return out;
    },

    /** 收到新快照：用伺服器狀態校正並重播未確認的輸入 */
    reconcile(serverMe) {
      if (!serverMe) return;
      if (!ready) { for (const f of FIELDS) if (serverMe[f] !== undefined) st[f] = serverMe[f]; ready = true; return; }
      const ack = serverMe.seq || 0;
      if (ack <= lastAck) return;
      lastAck = ack;
      const beforeX = st.x + smoothX, beforeY = st.y + smoothY;
      // 以權威狀態為起點
      for (const f of ['x', 'y', 'vx', 'vy', 'dashing', 'dashCd', 'inv', 'speedMul', 'dashCdMax', 'blinkCd', 'blinkCdMax']) if (serverMe[f] !== undefined) st[f] = serverMe[f];
      pending = pending.filter(q => q.seq > ack);
      for (const q of pending) stepPlayer(world, st, q.input, TICK_DT, NULL_FX);
      // 校正差異放進平滑偏移；差太大（被撞飛、瞬移）就直接跳
      const dx = beforeX - st.x, dy = beforeY - st.y;
      if (Math.hypot(dx, dy) < 120) { smoothX = dx; smoothY = dy; } else { smoothX = smoothY = 0; }
    },

    /** 把預測結果覆蓋到渲染用的玩家物件 */
    applyTo(p) {
      if (!ready || !p) return;
      p.x = st.x + smoothX; p.y = st.y + smoothY;
      p.vx = st.vx; p.vy = st.vy; p.angle = st.angle; p.dashing = st.dashing; p.dashCd = st.dashCd;
    },
  };
}
