import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { FetchAdapter, StorageAdapter, WorkerEnv } from '../src/shared/types.ts';
import worker from '../src/server/worker.ts';
import { applyMigrations, sqliteAdapter } from '../scripts/sqlite.ts';
import { parseJson } from '../src/shared/errors.ts';
import { objectInput } from '../src/shared/validation.ts';
import { field } from '../src/shared/values.ts';

// 使用真实 HTTP、文件存储和 SQLite，故障测试不替换应用函数。 Use real HTTP, file storage and SQLite without replacing application functions.
export async function ledgerServer(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'drinkdrink-integration-'));
  const databasePath = join(directory, 'ledger.sqlite');
  const storagePath = join(directory, 'storage.json');
  writeFileSync(storagePath, '{}');
  const db = new DatabaseSync(databasePath);
  applyMigrations(db);
  let databaseOpen = true;
  const closeDatabase = () => { db.close(); databaseOpen = false; };
  const env: WorkerEnv = { DB: sqliteAdapter(db), ASSETS: { async fetch() { return new Response(readFileSync(new URL('../src/client/index.html', import.meta.url)), { headers: { 'Content-Type': 'text/html' } }); } } };
  const server = createServer(async (incoming, outgoing) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const response = await worker.fetch(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method ?? 'GET', headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new TypeError('集成测试服务没有 TCP 地址');
  const origin = `http://127.0.0.1:${address.port}`;
  const request: FetchAdapter = (path, options) => fetch(origin + path, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), ...(options.method === 'PUT' ? { Origin: origin } : {}) } });
  const readStorage = (): Map<string, string> => {
    const value = objectInput(parseJson(readFileSync(storagePath, 'utf8'), 'file storage'), 'file storage');
    return new Map(Object.keys(value).map(key => {
      const item = field(value, key);
      if (typeof item !== 'string') throw new TypeError(`文件存储 ${key} 必须是字符串`);
      return [key, item];
    }));
  };
  const storage: StorageAdapter = {
    getItem: key => readStorage().get(key) ?? null,
    setItem: (key, value) => { writeFileSync(storagePath, JSON.stringify(Object.fromEntries([...readStorage(), [key, value]]))); },
    removeItem: key => { writeFileSync(storagePath, JSON.stringify(Object.fromEntries([...readStorage()].filter(([current]) => current !== key)))); },
  };
  let listening = true;
  const stop = async (): Promise<void> => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); listening = false; };
  t.after(async () => { if (listening) await stop(); if (databaseOpen) closeDatabase(); rmSync(directory, { recursive: true, force: true }); });
  return { origin, request, storage, storagePath, db, databasePath, closeDatabase, stop };
}
