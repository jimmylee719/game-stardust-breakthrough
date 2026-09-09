// 產生 PWA 圖示（純 Node，不需要任何套件）：深空底 + 霓虹船 + 光暈。
// 用法：node scripts/make-icons.cjs
const fs = require('fs'), zlib = require('zlib'), path = require('path');
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function make(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a = 1) => { if (x < 0 || y < 0 || x >= size || y >= size) return; const i = (y * size + x) * 4; px[i] = px[i] * (1 - a) + r * a; px[i + 1] = px[i + 1] * (1 - a) + g * a; px[i + 2] = px[i + 2] * (1 - a) + b * a; px[i + 3] = 255; };
  const cx = size / 2, cy = size / 2;
  // 背景：深空放射漸層 + 星星
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const d = Math.hypot(x - cx, y - cy) / (size * 0.7); const t = Math.min(1, d); put(x, y, 11 + (3 - 11) * t, 16 + (4 - 16) * t, 48 + (10 - 48) * t); }
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < size * 0.6; i++) { const x = Math.floor(rnd() * size), y = Math.floor(rnd() * size), a = 0.3 + rnd() * 0.7; put(x, y, 255, 255, 255, a); }
  // 船：三角形（朝右上），先畫光暈再畫實體
  const pts = [[0.72, 0.28], [0.28, 0.5], [0.46, 0.6], [0.4, 0.78]].map(([a, b]) => [a * size, b * size]);
  const tri = [[0.74, 0.26], [0.26, 0.52], [0.42, 0.62], [0.34, 0.76], [0.56, 0.6]].map(([a, b]) => [a * size, b * size]);
  const inside = (x, y, poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
  const distToPoly = (x, y, poly) => { let best = 1e9; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [x1, y1] = poly[j], [x2, y2] = poly[i]; const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)); best = Math.min(best, Math.hypot(x - (x1 + dx * t), y - (y1 + dy * t))); } return best; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = distToPoly(x, y, tri), inn = inside(x, y, tri);
    const glow = Math.max(0, 1 - d / (size * 0.12)); if (glow > 0) put(x, y, 76, 201, 240, glow * glow * 0.6);
    if (inn) put(x, y, 232, 246, 255, 1);
    if (d < size * 0.012) put(x, y, 76, 201, 240, 1);
  }
  // 引擎火光
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const ex = 0.3 * size, ey = 0.66 * size; const d = Math.hypot((x - ex) * 1.2, y - ey) / (size * 0.1); if (d < 1) put(x, y, 255, 160, 60, (1 - d) * 0.8); }
  return png(size, size, px);
}
const out = path.join(__dirname, '..', 'public');
for (const s of [192, 512]) { fs.writeFileSync(path.join(out, `icon-${s}.png`), make(s)); console.log('icon', s); }
