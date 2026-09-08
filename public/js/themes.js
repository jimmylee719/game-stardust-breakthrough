// 視覺主題機制（純客戶端，不影響遊戲邏輯與伺服器）。目前遊戲鎖定「霓虹」單一風格。
// 做法：程式碼裡的「來源色盤」固定不動，主題提供一張「來源色 → 目標色」對照表；
// 渲染用的 Canvas context 被包一層，凡是設定 fillStyle / strokeStyle / shadowColor 都先經過對照表，
// 同時可縮放光暈、線寬、字型與內部解析度（像素風）。
// 好處：render.js、effects.js、伺服器送來的 fx 事件顏色全都不用改，一次到位。

// 來源色盤（程式碼中實際使用的顏色，供對照表鍵值參考）
//   玩家 #4cc9f0 #f9c74f #90f1a8 #f48fb1
//   敵人 drifter #ff5f7a  dart #ffd166  tank #9b5de5  shooter #00f5d4  splitter #f15bb5  rock #b8b8c8
//   Boss 第一/三階段 #ff3860  第二階段 #ff8c42  追蹤球 #c77dff
//   道具 heal #3ddc84  spread #ffd166  rapid #ff8c42  shield #4cc9f0  bomb #ff3860
//   白 #ffffff  機身 #e8f6ff  槍口 #ffe9a8  追蹤彈 #fff3c4  Boss 核心 #ffb3c1  眼 #1a0010  倒地 #6a6a7a

export const THEMES = {
  neon: {
    name: '霓虹', desc: '深空、強光暈。整個遊戲的唯一視覺風格',
    bg: ['#0b1030', '#03040a'], letterbox: '#03040a', star: '255,255,255',
    glow: 1, lineMul: 1, font: null, pixelScale: null,
    map: {},
  },
  // 之後要做活動主題或付費外觀：在這裡加一個物件（對照表鍵值見檔案開頭註解），
  // 並在 UI 提供切換即可；渲染與伺服器不需改動。
};
export const THEME_IDS = Object.keys(THEMES);

let current = THEMES.neon;
let currentId = 'neon';
let hexMap = new Map();     // '#rrggbb' -> '#rrggbb'
let rgbMap = new Map();     // 'r,g,b'   -> 'r,g,b'
const listeners = new Set();

function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function normHex(h) { h = h.toLowerCase(); if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; return h; }

export function getTheme() { return current; }
export function getThemeId() { return currentId; }
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setTheme(id) {
  const t = THEMES[id] || THEMES.neon;
  current = t; currentId = THEMES[id] ? id : 'neon';
  hexMap = new Map(); rgbMap = new Map();
  for (const [from, to] of Object.entries(t.map)) {
    const f = normHex(from), tt = normHex(to);
    hexMap.set(f, tt);
    rgbMap.set(hexToRgb(f).join(','), hexToRgb(tt).join(','));
  }
  applyCss(t);
  for (const fn of listeners) fn(t);
}

/** 把任何 CSS 顏色字串依對照表轉換（支援 #rgb、#rrggbb、#rrggbbaa、rgb()、rgba()） */
export function remapColor(c) {
  if (typeof c !== 'string' || hexMap.size === 0) return c;
  const s = c.trim();
  if (s[0] === '#') {
    const base = s.length >= 7 ? s.slice(0, 7).toLowerCase() : normHex(s);
    const suffix = s.length > 7 ? s.slice(7) : '';
    const m = hexMap.get(base);
    return m ? m + suffix : c;
  }
  if (s.startsWith('rgb')) {
    const nums = s.slice(s.indexOf('(') + 1, s.indexOf(')')).split(',').map(v => v.trim());
    const key = nums.slice(0, 3).map(v => String(Math.round(+v))).join(',');
    const m = rgbMap.get(key);
    if (!m) return c;
    return nums.length > 3 ? `rgba(${m},${nums[3]})` : `rgb(${m})`;
  }
  return c;
}

/** 包住 CanvasRenderingContext2D：顏色重映射、光暈與線寬縮放、字型替換 */
export function themedContext(raw) {
  // 霓虹（預設）沒有任何重映射：直接回傳原生 context，避免 Proxy 每個屬性存取的額外成本（敵人多時掉幀的主因之一）
  if (hexMap.size === 0 && current.glow === 1 && current.lineMul === 1 && !current.font) return raw;
  return new Proxy(raw, {
    get(t, k) {
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) {
      if (k === 'fillStyle' || k === 'strokeStyle' || k === 'shadowColor') t[k] = remapColor(v);
      else if (k === 'shadowBlur') t[k] = v * current.glow;
      else if (k === 'lineWidth') t[k] = v * current.lineMul;
      else if (k === 'font' && current.font && typeof v === 'string') t[k] = v.replace(/sans-serif/, current.font);
      else t[k] = v;
      return true;
    },
  });
}

/** 選單、大廳等 HTML 覆蓋層跟著主題換色 */
function applyCss(t) {
  const root = document.documentElement.style;
  root.setProperty('--accent', remapColor('#4cc9f0'));
  root.setProperty('--gold', remapColor('#ffd166'));
  root.setProperty('--danger', remapColor('#ff3860'));
  root.setProperty('--good', remapColor('#90f1a8'));
  root.setProperty('--text', remapColor('#ffffff'));
  root.setProperty('--bg', t.letterbox);
  root.setProperty('--panel', t.bg[0] + 'cc');
  root.setProperty('--font', t.font || '"Segoe UI", "Noto Sans TC", system-ui, sans-serif');
  document.body.classList.toggle('pixel', !!t.pixelScale);
}

// 啟動即套用霓虹
setTheme('neon');
