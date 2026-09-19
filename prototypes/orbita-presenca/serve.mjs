import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Servidor só para a proposta. Não expõe o repositório nem depende do backend.
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.ORBITA_PREVIEW_PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const allowed = new Set(['index.html', 'styles.css', 'app.js', 'orb.js', 'orb-3d.js', 'research.js', 'orbita-presenca.html']);
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const path = resolve(root, file);
    if (!path.startsWith(root + sep) || !allowed.has(file)) { res.writeHead(404); res.end('Not found'); return; }
    const info = await stat(path);
    if (!info.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('error', error => { console.error(`Não foi possível abrir o preview: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => { console.log(`Órbita Presença: http://127.0.0.1:${port}`); });
