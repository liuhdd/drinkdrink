import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import worker from '../server/worker.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(resolve(root, '.local-data'), { recursive: true });
const db = new DatabaseSync(resolve(root, '.local-data/ledger.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS local_migrations (tag TEXT PRIMARY KEY)');
const journal = JSON.parse(readFileSync(resolve(root, 'drizzle/meta/_journal.json')));
for (const entry of journal.entries) {
  if (db.prepare('SELECT tag FROM local_migrations WHERE tag = ?').get(entry.tag)) continue;
  db.exec('BEGIN');
  try {
    db.exec(readFileSync(resolve(root, `drizzle/${entry.tag}.sql`), 'utf8'));
    db.prepare('INSERT INTO local_migrations (tag) VALUES (?)').run(entry.tag);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css' };
const env = {
  DB: { prepare(sql) {
    const stmt = db.prepare(sql);
    return { bind(...params) { return {
      async first() { return stmt.get(...params) ?? null; },
      async run() { return { meta: { changes: Number(stmt.run(...params).changes) } }; },
    }; } };
  } },
  ASSETS: { async fetch(request) {
    const path = new URL(request.url).pathname;
    const files = ['index.html', 'app.mjs', 'domain.mjs', 'persistence.mjs', 'style.css'];
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (!files.includes(file)) return new Response('Not found', { status: 404 });
    return new Response(readFileSync(resolve(root, 'dist', file)), { headers: { 'Content-Type': `${mime[extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-store' } });
  } },
};

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    // Loopback-only development identity; production receives identity from Sites dispatch.
    headers.set('oai-authenticated-user-id', 'local-dev');
    const request = new Request(`http://127.0.0.1:4173${incoming.url}`, { method: incoming.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); outgoing.writeHead(500); outgoing.end('Local server error'); }
});
server.listen(4173, '127.0.0.1', () => console.log('本地预览：http://127.0.0.1:4173'));
