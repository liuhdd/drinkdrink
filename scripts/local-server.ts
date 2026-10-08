import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failureLog } from '../src/shared/logging.ts';
import { context, errorBody, isProblem, problem } from '../src/shared/errors.ts';
import worker, { cleanupExpired } from '../src/server/worker.ts';
import type { WorkerEnv } from '../src/shared/types.ts';
import { applyMigrations, sqliteAdapter } from './sqlite.ts';

type AssetHandler = (incoming: IncomingMessage, outgoing: ServerResponse) => Promise<void>;
export async function startLocalServer(port: number, assets: AssetHandler, disposeAssets: () => Promise<void>): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dataDir = process.env.LEDGER_DATA_DIR ?? resolve(root, '.local-data');
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, 'ledger.sqlite'));
  applyMigrations(db);
  const env: WorkerEnv = { DB: sqliteAdapter(db), ASSETS: { fetch: () => { throw new Error('静态资源请求必须交给客户端处理器'); } } };
  await cleanupExpired(env.DB, Date.now());
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (!new URL(incoming.url ?? '/', `http://127.0.0.1:${port}`).pathname.startsWith('/api/')) { await assets(incoming, outgoing); return; }
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
      const failure = isProblem(cause) ? cause : problem('INTERNAL', `本地 HTTP 请求失败：${cause.message}`, { ...context('local HTTP request', null), request: { method: incoming.method ?? 'GET', url: incoming.url ?? '/', body: null, deviceId: incoming.headers['x-device-id']?.toString() ?? null, requestId: incoming.headers['x-request-id']?.toString() ?? null }, status: 500 }, cause);
      console.error(failureLog('local HTTP', failure));
      outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify(errorBody(failure)));
    }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  console.log({ event: 'local_server_ready', url: `http://127.0.0.1:${port}` });
  const timer = setInterval(() => cleanupExpired(env.DB, Date.now()).catch(error => { clearInterval(timer); throw error; }), 60 * 60 * 1000);
  timer.unref();
  const stop = () => {
    clearInterval(timer);
    server.close(() => { db.close(); void disposeAssets(); });
    server.closeAllConnections();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
