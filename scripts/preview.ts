import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from './local-server.ts';

const root = fileURLToPath(new URL('../dist/client/', import.meta.url));
const mime = new Map([['.html', 'text/html'], ['.js', 'text/javascript'], ['.css', 'text/css'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.txt', 'text/plain']]);
await startLocalServer(Number(process.env.PORT ?? 4173), async (incoming, outgoing) => {
  if (!['GET', 'HEAD'].includes(incoming.method ?? 'GET')) { outgoing.writeHead(405); outgoing.end(); return; }
  const path = decodeURIComponent(new URL(incoming.url ?? '/', 'http://localhost').pathname);
  const file = resolve(root, path === '/' ? 'index.html' : `.${path}`);
  if (!file.startsWith(root)) { outgoing.writeHead(403); outgoing.end(); return; }
  let data: Buffer;
  try { data = await readFile(file); }
  catch (caught) {
    if (caught instanceof Error && 'code' in caught && caught.code === 'ENOENT') { outgoing.writeHead(404); outgoing.end('Not found'); return; }
    throw caught;
  }
  outgoing.writeHead(200, { 'Content-Type': `${mime.get(extname(file)) ?? 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
  outgoing.end(incoming.method === 'HEAD' ? undefined : data);
}, async () => {});
