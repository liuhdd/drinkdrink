import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../server/worker.mjs';
import { emptyLedger } from '../dist/persistence.mjs';

function environment() {
  const db = new DatabaseSync(':memory:');
  for (const file of JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url))).entries) {
    db.exec(readFileSync(new URL(`../drizzle/${file.tag}.sql`, import.meta.url), 'utf8'));
  }
  return { db, env: { DB: { prepare(sql) {
    const stmt = db.prepare(sql);
    return { bind(...params) { return {
      async first() { return stmt.get(...params) ?? null; },
      async run() { return { meta: { changes: Number(stmt.run(...params).changes) } }; },
    }; } };
  } } } };
}

const request = (user, method = 'GET', body) => new Request('https://ledger.test/api/ledger', {
  method, headers: { ...(user ? { 'oai-authenticated-user-id': user } : {}), 'content-type': 'application/json', origin: 'https://ledger.test' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('服务端按登录用户保存，拒绝匿名、跨站写入、无效记录和过期版本', async () => {
  const { db, env } = environment();
  try {
    assert.equal((await worker.fetch(request(null), env)).status, 401);
    assert.deepEqual(await (await worker.fetch(request('user-a'), env)).json(), { ledger: null, revision: 0 });
    const ledger = emptyLedger();
    const saved = await worker.fetch(request('user-a', 'PUT', { ledger, revision: 0 }), env);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revision, 1);
    assert.deepEqual((await (await worker.fetch(request('user-a'), env)).json()).ledger, ledger);
    assert.equal((await (await worker.fetch(request('user-b'), env)).json()).ledger, null);
    assert.equal((await worker.fetch(request('user-a', 'PUT', { ledger, revision: 0 }), env)).status, 409);
    const updated = { ...ledger, step: 4 };
    assert.equal((await worker.fetch(request('user-a', 'PUT', { ledger: updated, revision: 1 }), env)).status, 200);
    assert.equal((await worker.fetch(request('user-a', 'PUT', { ledger, revision: 1 }), env)).status, 409);
    assert.equal((await worker.fetch(request('user-a', 'PUT', { ledger: { version: 99 }, revision: 2 }), env)).status, 400);
    const crossSite = request('user-a', 'PUT', { ledger, revision: 2 });
    crossSite.headers.set('origin', 'https://other.test');
    assert.equal((await worker.fetch(crossSite, env)).status, 403);
    assert.equal((await (await worker.fetch(request('user-a'), env)).json()).ledger.step, 4);
  } finally { db.close(); }
});
