// 靜態檔伺服器：提供 public/ 與 shared/ 給瀏覽器。
// 第二步會在這裡加上 WebSocket 房間伺服器；目前只負責出檔案。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = Number(process.env.PORT) || 8765;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function resolveFile(urlPath) {
  // /shared/... 對應到專案的 shared 目錄，其餘從 public 出檔
  let base = PUBLIC, rel = urlPath;
  if (urlPath === '/shared' || urlPath.startsWith('/shared/')) { base = SHARED; rel = urlPath.slice('/shared'.length); }
  if (rel === '' || rel === '/') rel = '/index.html';
  const abs = path.normalize(path.join(base, rel));
  if (!abs.startsWith(base)) return null; // 防止路徑跳脫
  return abs;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = resolveFile(decodeURIComponent(url.pathname));
  if (!file) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`星塵突圍 dev server → http://localhost:${PORT}`);
});
