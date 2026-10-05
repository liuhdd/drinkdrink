import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = new Set(['index.html', 'app.mjs', 'domain.mjs', 'persistence.mjs', 'device-storage.mjs', 'style.css']);
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css' };

const server = createServer((request, response) => {
  try {
    const path = new URL(request.url, 'http://127.0.0.1:4173').pathname;
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (!files.has(file)) { response.writeHead(404); response.end('Not found'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end('Method not allowed'); return; }
    response.writeHead(200, { 'Content-Type': `${mime[extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : readFileSync(resolve(root, 'dist', file)));
  } catch (error) { console.error(error); response.writeHead(500); response.end('Local preview error'); }
});
server.listen(4173, '127.0.0.1', () => console.log('本地预览：http://127.0.0.1:4173（记录保存在浏览器）'));
