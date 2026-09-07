// 美術主題系統（純客戶端，不影響遊戲邏輯與伺服器）。
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
    name: '霓虹', desc: '預設。深空、強光暈',
    bg: ['#0b1030', '#03040a'], letterbox: '#03040a', star: '255,255,255',
    glow: 1, lineMul: 1, font: null, pixelScale: null,
    map: {},
  },
  sunset: {
    name: '夕陽', desc: '暖色、紫紅天空',
    bg: ['#3a1d4f', '#120818'], letterbox: '#0b050f', star: '255,220,180',
    glow: 1.2, lineMul: 1, font: null, pixelScale: null,
    map: {
      '#4cc9f0': '#ffd97d', '#f9c74f': '#ff9f68', '#90f1a8': '#f7b2ff', '#f48fb1': '#8ce0ff',
      '#ff5f7a': '#ff4d6d', '#ffd166': '#ffb347', '#9b5de5': '#c9184a', '#00f5d4': '#ffe066', '#f15bb5': '#ff7b9c', '#b8b8c8': '#c8a48a',
      '#ff3860': '#ff2e63', '#ff8c42': '#ffb347', '#c77dff': '#ffe066',
      '#3ddc84': '#a8e063', '#e8f6ff': '#fff4e0', '#ffe9a8': '#ffe9a8',
    },
  },
  ink: {
    name: '水墨', desc: '米紙底、墨線、一點朱砂',
    bg: ['#f6f1e7', '#ddd5c6'], letterbox: '#cfc6b5', star: '70,60,50',
    glow: 0, lineMul: 1.35, font: '"Noto Serif TC", "PMingLiU", Georgia, serif', pixelScale: null,
    map: {
      '#ffffff': '#1d1a17', '#e8f6ff': '#fbf8f2', '#ffe9a8': '#8a7e6a', '#fff3c4': '#3a342c',
      '#4cc9f0': '#2f4858', '#f9c74f': '#8c6d1f', '#90f1a8': '#3c6e47', '#f48fb1': '#7a3b4f',
      '#ff5f7a': '#b7322c', '#ffd166': '#a8862a', '#9b5de5': '#4b3b6b', '#00f5d4': '#2e6b5e', '#f15bb5': '#8e3a62', '#b8b8c8': '#6f6a62',
      '#ff3860': '#c1272d', '#ff8c42': '#b8651b', '#c77dff': '#5e4b8b',
      '#3ddc84': '#3c6e47', '#ffb3c1': '#e8c7c1', '#1a0010': '#1d1a17', '#6a6a7a': '#8a8580',
      // 深色 UI 底（名牌、升級卡、結算遮罩）在紙底上翻成淺色
      '#03040a': '#f6f1e7', '#0e1228': '#fbf8f2', '#282414': '#efe4cc', '#000000': '#f6f1e7',
    },
  },
  pixel: {
    name: '像素', desc: '復古 16 色、低解析度',
    bg: ['#1d2b53', '#000000'], letterbox: '#000000', star: '255,241,232',
    glow: 0, lineMul: 1.6, font: '"Courier New", monospace', pixelScale: 0.3,
    map: {
      '#4cc9f0': '#29adff', '#f9c74f': '#ffec27', '#90f1a8': '#00e436', '#f48fb1': '#ff77a8',
      '#ff5f7a': '#ff004d', '#ffd166': '#ffa300', '#9b5de5': '#83769c', '#00f5d4': '#00e436', '#f15bb5': '#ff77a8', '#b8b8c8': '#c2c3c7',
      '#ff3860': '#ff004d', '#ff8c42': '#ffa300', '#c77dff': '#ff77a8',
      '#3ddc84': '#00e436', '#e8f6ff': '#fff1e8', '#ffe9a8': '#ffec27', '#fff3c4': '#ffec27', '#ffb3c1': '#ffccaa', '#6a6a7a': '#5f574f',
    },
  },
  candy: {
    name: '糖果', desc: '粉彩、圓潤、超亮光暈',
    bg: ['#4a2d7a', '#1b1233'], letterbox: '#120b22', star: '255,230,255',
    glow: 1.6, lineMul: 1.25, font: null, pixelScale: null,
    map: {
      '#4cc9f0': '#8be9fd', '#f9c74f': '#fff394', '#90f1a8': '#b6ffb0', '#f48fb1': '#ffb3e6',
      '#ff5f7a': '#ff8fab', '#ffd166': '#ffe29a', '#9b5de5': '#c8a2ff', '#00f5d4': '#7fffe0', '#f15bb5': '#ff9de2', '#b8b8c8': '#d9d4ff',
      '#ff3860': '#ff6b9d', '#ff8c42': '#ffb26b', '#c77dff': '#e0b3ff',
      '#3ddc84': '#8affc1',
    },
  },
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
  try { localStorage.setItem('stardust_theme', currentId); } catch {}
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

/** 建立主題選擇的按鈕列 */
export function renderThemePicker(container) {
  container.innerHTML = '';
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip' + (id === currentId ? ' on' : ''); b.dataset.theme = id; b.title = t.desc;
    b.innerHTML = `<span class="sw" style="background:linear-gradient(135deg,${t.bg[0]},${t.map['#4cc9f0'] || '#4cc9f0'})"></span>${t.name}`;
    b.addEventListener('click', () => { setTheme(id); });
    container.appendChild(b);
  }
  onThemeChange(() => { for (const el of container.querySelectorAll('.chip')) el.classList.toggle('on', el.dataset.theme === currentId); });
}

// 啟動時套用上次選的主題
setTheme(localStorage.getItem('stardust_theme') || 'neon');
