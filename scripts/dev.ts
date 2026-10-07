import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { context } from 'esbuild';
import { context as errorContext, errorBody, isProblem, problem } from '../src/shared/errors.ts';
import worker, { cleanupExpired } from '../src/server/worker.ts';
import type { WorkerEnv } from '../src/shared/types.ts';
import { buildClient, clientBuildOptions } from './client.ts';
import { applyMigrations, sqliteAdapter } from './sqlite.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const dataDir = process.env.LEDGER_DATA_DIR ?? resolve(root, '.local-data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'ledger.sqlite'));
applyMigrations(db);
await buildClient();
const builder = await context(clientBuildOptions());
await builder.watch({});
const mime = new Map([['.html', 'text/html'], ['.mjs', 'text/javascript'], ['.css', 'text/css']]);
const env: WorkerEnv = {
  DB: sqliteAdapter(db),
  ASSETS: { async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (!['index.html', 'app.mjs', 'style.css'].includes(file)) return new Response('Not found', { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    return new Response(request.method === 'HEAD' ? null : readFileSync(resolve(root, file === 'app.mjs' ? 'dist/client' : 'src/client', file)), { headers: { 'Content-Type': `${mime.get(extname(file))}; charset=utf-8`, 'Cache-Control': 'no-store' } });
  } },
};
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 2_000_000) { outgoing.writeHead(413); outgoing.end('Payload too large'); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const request = new Request(`http://${incoming.headers.host ?? `127.0.0.1:${port}`}${incoming.url}`, { method: incoming.method ?? 'GET', headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (caught) {
    const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
    const failure = isProblem(cause) ? cause : problem('INTERNAL', `本地 HTTP 请求失败：${cause.message}`, { ...errorContext('local HTTP request', null), request: { method: incoming.method ?? 'GET', url: incoming.url ?? '/', body: null, deviceId: incoming.headers['x-device-id']?.toString() ?? null }, status: 500 }, cause);
    console.error(failure);
    outgoing.writeHead(500, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify(errorBody(failure)));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`本地预览：http://127.0.0.1:${port}`));
await cleanupExpired(env.DB, Date.now());
const cleanupTimer = setInterval(() => cleanupExpired(env.DB, Date.now()).catch(error => { clearInterval(cleanupTimer); throw error; }), 60 * 60 * 1000);
cleanupTimer.unref();
process.once('SIGTERM', () => { clearInterval(cleanupTimer); server.close(() => { db.close(); void builder.dispose(); }); });
