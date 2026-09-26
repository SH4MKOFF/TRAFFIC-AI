import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const publicRoot = projectRoot;
const host = '127.0.0.1';
const port = Number(process.env.GHOST_PREVIEW_PORT || 5173);

const mime = new Map([
  ['.html','text/html; charset=utf-8'],
  ['.js','text/javascript; charset=utf-8'],
  ['.mjs','text/javascript; charset=utf-8'],
  ['.css','text/css; charset=utf-8'],
  ['.json','application/json; charset=utf-8'],
  ['.svg','image/svg+xml'],
  ['.png','image/png'],
  ['.jpg','image/jpeg'],
  ['.jpeg','image/jpeg'],
  ['.webmanifest','application/manifest+json'],
  ['.ico','image/x-icon'],
]);

function safeResolve(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const clean = decoded.replace(/\\/g, '/');
  const candidate = path.resolve(publicRoot, '.' + clean);
  if (candidate !== publicRoot && !candidate.startsWith(publicRoot + path.sep)) return null;
  return candidate;
}

function sendFile(res, filePath, status = 200) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
      res.end('Not found');
      return;
    }
    const type = mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Resource-Policy': 'same-origin'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url || '/', `http://${host}:${port}`);
  let pathname = parsed.pathname;

  if (pathname === '/' || pathname === '/preview' || pathname === '/preview/') {
    pathname = '/tools/iphone-preview/index.html';
  }

  let filePath = safeResolve(pathname);
  if (!filePath) {
    res.writeHead(400, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('Bad request');
    return;
  }

  // Serve directory indexes so /www/ resolves to www/index.html.
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    // sendFile() will return the correct 404 below.
  }

  sendFile(res, filePath);
});

server.listen(port, host, () => {
  console.log(`GHOST iPhone Preview: http://${host}:${port}/preview/`);
  console.log(`GHOST Web:          http://${host}:${port}/www/`);
  console.log('Press Ctrl+C to stop.');
});
