import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, sqliteAdapter } from '../scripts/sqlite.ts';
import worker, { cleanupExpired } from '../src/server/worker.ts';
import { decodeCharadesSnapshot, type CharadesNextRequest, type CharadesSnapshot } from '../src/shared/charades.ts';
import type { WorkerEnv } from '../src/shared/types.ts';
import { CHARADES_QUESTIONS } from '../src/server/charades-questions.ts';
import { at, field } from '../src/shared/values.ts';
import { RETENTION_MS } from '../src/server/retention.ts';

function setup(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  applyMigrations(db);
  const env: WorkerEnv = { DB: sqliteAdapter(db), ASSETS: { fetch: () => new Response('asset') } };
  const load = (deviceId: string) => worker.fetch(new Request('https://ledger.test/api/charades', { headers: { 'X-Device-ID': deviceId } }), env);
  const next = (deviceId: string, data: CharadesNextRequest, requestId: string) => worker.fetch(new Request('https://ledger.test/api/charades/next', { method: 'POST', headers: { 'X-Device-ID': deviceId, 'X-Request-ID': requestId, Origin: 'https://ledger.test', 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), env);
  return { db, env, load, next };
}
async function read(response: Response): Promise<CharadesSnapshot> {
  assert.equal(response.status, 200, await response.clone().text());
  return decodeCharadesSnapshot(await response.json());
}

test('真实SQLite按设备保存首题，刷新与账本清理保留进度，全部题目无放回后开启新轮', async t => {
  const { load, next, env } = setup(t), device = crypto.randomUUID();
  const initialResponses = await Promise.all([load(device), load(device)]);
  const first = await read(at(initialResponses, 0));
  assert.deepEqual(await read(at(initialResponses, 1)), first);
  assert.equal(first.total, 1000);
  assert.equal(first.drawn, 1);
  assert.equal(first.round, 1);
  assert.equal(first.revision, 1);
  assert.equal(Object.hasOwn(first.question, 'sourceId'), false);
  const independent = await read(await load(crypto.randomUUID()));
  assert.notEqual(independent.generation, first.generation);
  let current = first;
  const seen = new Set([first.question.id]);
  const seenText = new Set([first.question.text]);
  for (let index = 1; index < first.total; index++) {
    current = await read(await next(device, current, crypto.randomUUID()));
    assert.equal(current.drawn, index + 1);
    assert.equal(current.round, 1);
    assert.equal(seen.has(current.question.id), false);
    assert.equal(seenText.has(current.question.text), false);
    seen.add(current.question.id);
    seenText.add(current.question.text);
  }
  assert.deepEqual([...seen].sort(), CHARADES_QUESTIONS.map(question => question.id).sort());
  assert.deepEqual(await read(await load(device)), current);
  await cleanupExpired(env.DB, Date.now() + RETENTION_MS * 2);
  assert.deepEqual(await read(await load(device)), current);
  const newRound = await read(await next(device, current, crypto.randomUUID()));
  assert.equal(newRound.round, 2);
  assert.equal(newRound.drawn, 1);
  assert.equal(newRound.revision, first.total + 1);
  assert.notEqual(newRound.question.id, current.question.id);
  assert.equal(newRound.generation, first.generation);
});

test('真实SQLite下一题并发仅前进一步，响应重放不跳题且拒绝复用请求标识修改内容', async t => {
  const { load, next } = setup(t), device = crypto.randomUUID();
  const first = await read(await load(device)), requestId = crypto.randomUUID();
  const writes = await Promise.all([next(device, first, requestId), next(device, first, requestId)]);
  const second = await read(at(writes, 0));
  assert.deepEqual(await read(at(writes, 1)), second);
  assert.equal(second.drawn, 2);
  assert.equal(second.revision, 2);
  assert.notEqual(second.question.id, first.question.id);
  assert.deepEqual(await read(await next(device, first, requestId)), second);
  const misuse = await next(device, second, requestId);
  assert.equal(misuse.status, 400);
  assert.equal(field(await misuse.json(), 'code'), 'VALIDATION');
  const competing = await Promise.all([next(device, second, crypto.randomUUID()), next(device, second, crypto.randomUUID())]);
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
  const latest = await read(await load(device));
  assert.equal(latest.drawn, 3);
  const conflict = competing.find(response => response.status === 409);
  assert.ok(conflict);
  const payload = await conflict.json();
  assert.equal(field(payload, 'code'), 'CONFLICT');
  assert.deepEqual(decodeCharadesSnapshot(payload), latest);
  const oldGeneration = await next(device, { revision: latest.revision, generation: crypto.randomUUID() }, crypto.randomUUID());
  assert.equal(oldGeneration.status, 409);
  assert.deepEqual(await read(await load(device)), latest);
});

test('真实SQLite损坏出题进度明确报错，非法设备与跨站下一题被拒绝且不修改原进度', async t => {
  const { load, next, db, env } = setup(t), device = crypto.randomUUID();
  const first = await read(await load(device));
  const crossSite = await worker.fetch(new Request('https://ledger.test/api/charades/next', { method: 'POST', headers: { 'X-Device-ID': device, 'X-Request-ID': crypto.randomUUID(), Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: JSON.stringify(first) }), env);
  assert.equal(crossSite.status, 403);
  assert.equal((await load('invalid')).status, 400);
  assert.deepEqual(await read(await load(device)), first);
  db.prepare('UPDATE device_charades SET question_order = ? WHERE device_id = ?').run('["missing-question"]', device);
  const corrupted = await load(device);
  assert.equal(corrupted.status, 500);
  const body = await corrupted.json();
  assert.equal(field(body, 'code'), 'CORRUPT_STORAGE');
  assert.match(String(field(body, 'error')), /question_order/);
  assert.equal((await next(device, first, crypto.randomUUID())).status, 500);
});
