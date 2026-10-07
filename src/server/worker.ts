import { failureLog } from '../shared/logging.ts';
import { uuidInput } from '../shared/validation.ts';
import { diagnosticDatabase } from './database.ts';
import { context, problem, isProblem, errorBody, parseJson, type RequestDetails } from '../shared/errors.ts';
import { rowInput, storedLedger } from './records.ts';
import { saveRequestInput } from '../shared/protocol.ts';
import type { ExternalValue, WorkerEnv, LedgerDatabase, DatabaseRow, Snapshot, Ledger } from '../shared/types.ts';
import { field } from '../shared/values.ts';
import { restoreLedger } from '../shared/persistence.ts';
import { RETENTION_MS, retainLedger, prepareLedger } from './retention.ts';

const json = (value: object, status: number): Response => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'X-Device-ID' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const empty = (): Snapshot => ({ ledger: null, revision: 0, generation: null });

async function readRow(db: LedgerDatabase, deviceId: string): Promise<DatabaseRow | null> {
  const sql = 'SELECT device_id, data, revision, generation, updated_at, cleanup_at, last_request_id, last_request_hash FROM device_ledgers WHERE device_id = ?';
  const value = await db.prepare(sql).bind(deviceId).first();
  return value === null ? null : rowInput(value, sql, [deviceId]);
}

async function pruneRow(db: LedgerDatabase, row: DatabaseRow, now: number): Promise<void> {
  if (row.cleanup_at >= now) return;
  const stored = decodeStored(row);
  const kept = retainLedger(stored.ledger, stored.memberSeen, now);
  // 仅数据内容变化才使已打开页面失效，清理不延长设备寿命。 Only a semantic change invalidates open pages. Cleanup never extends device lifetime.
  const changed = JSON.stringify({ ledger: kept.ledger, memberSeen: kept.memberSeen }) !== row.data;
  await db.prepare('UPDATE device_ledgers SET data = ?, revision = revision + ?, cleanup_at = ? WHERE device_id = ? AND revision = ? AND generation = ?')
    .bind(JSON.stringify({ ledger: kept.ledger, memberSeen: kept.memberSeen }), changed ? 1 : 0, kept.cleanupAt, row.device_id, row.revision, row.generation).run();
}

async function readCurrent(db: LedgerDatabase, deviceId: string, now: number): Promise<DatabaseRow | null> {
  await db.prepare('DELETE FROM device_ledgers WHERE device_id = ? AND updated_at < ?').bind(deviceId, now - RETENTION_MS).run();
  let row = await readRow(db, deviceId);
  if (row) {
    await pruneRow(db, row, now);
    row = await readRow(db, deviceId);
  }
  return row;
}

function decodeStored(row: DatabaseRow) {
  try { return storedLedger(parseJson(row.data, 'decode stored ledger')); }
  catch (caught) {
    if (!(caught instanceof Error)) throw caught;
    throw problem('CORRUPT_STORAGE', `服务端账本损坏：${caught.message}`, { ...context('decode stored ledger', isProblem(caught) ? caught.details.path : null), responseBody: row.data, database: { sql: 'device_ledgers.data', parameters: [row.device_id] } }, caught);
  }
}

const responseData = (row: DatabaseRow | null): Snapshot => row ? { ledger: restoreLedger(decodeStored(row).ledger), revision: row.revision, generation: row.generation } : empty();

export async function cleanupExpired(rawDatabase: LedgerDatabase, now: number): Promise<void> {
  const db = diagnosticDatabase(rawDatabase);
  await db.prepare('DELETE FROM device_ledgers WHERE updated_at < ?').bind(now - RETENTION_MS).run();
  // 使用索引和有界批次，使定时任务符合 Worker 限制。 Indexed, bounded batches keep scheduled work within Worker limits.
  for (let batch = 0; batch < 10; batch++) {
    const sql = 'SELECT device_id, data, revision, generation, updated_at, cleanup_at, last_request_id, last_request_hash FROM device_ledgers WHERE cleanup_at < ? LIMIT 100';
    const { results } = await db.prepare(sql).bind(now).all();
    if (!results.length) break;
    for (const row of results) await pruneRow(db, rowInput(row, sql, [now]), now);
  }
}

export default {
  async scheduled(event: { scheduledTime: number }, env: WorkerEnv) { await cleanupExpired(env.DB, event.scheduledTime); },
  async fetch(request: Request, env: WorkerEnv) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname !== '/api/ledger') return rejected(request, 'HTTP', `接口不存在：${url.pathname}`, 404);
    if (!['GET', 'PUT'].includes(request.method)) return rejected(request, 'HTTP', `不支持请求方法 ${request.method}，请使用 GET 或 PUT`, 405);
    const deviceId = request.headers.get('x-device-id');
    if (deviceId === null || !uuid.test(deviceId)) return rejected(request, 'VALIDATION', '设备标识无效，X-Device-ID 必须是 UUID v4', 400);
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.method === 'PUT' && request.headers.get('origin') !== url.origin)) return rejected(request, 'HTTP', `请在本站访问记录，Origin 必须是 ${url.origin}`, 403);
    let requestBody: string | null = null;
    try {
      const requestId = request.method === 'PUT' && request.headers.has('x-request-id') ? uuidInput(request.headers.get('x-request-id'), 'X-Request-ID') : null;
      const now = Date.now();
      const database = diagnosticDatabase(env.DB);
      if (request.method === 'GET') return json(responseData(await readCurrent(database, deviceId, now)), 200);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return rejected(request, 'VALIDATION', '记录格式无效，Content-Type 必须是 application/json', 400);
      if (Number(request.headers.get('content-length')) > 2_000_000) return rejected(request, 'VALIDATION', '记录超过保存容量，最大为 2000000 字节', 413);
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (request.body) {
        const reader = request.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2_000_000) { await reader.cancel(); return rejected(request, 'VALIDATION', '记录超过保存容量，最大为 2000000 字节', 413); }
          chunks.push(value);
        }
      }
      let data: { revision: number; generation: string | null };
      let ledger: Ledger;
      try {
        requestBody = new TextDecoder().decode(combineChunks(chunks, size));
        const input = parseJson(requestBody, 'decode save request');
        const parsed = saveRequestInput(input, now);
        data = { revision: parsed.revision, generation: parsed.generation };
        ledger = parsed.ledger;
      } catch (caught) {
        if (!isProblem(caught instanceof Error ? caught : undefined) && !(caught instanceof SyntaxError)) throw caught;
        const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
        const validation = isProblem(cause) ? cause : problem('VALIDATION', cause.message, context('decode save request', null), cause);
        return errorResponse(validation, { method: request.method, url: request.url, body: requestBody, deviceId, requestId: request.headers.get('x-request-id') }, 400);
      }
      const requestHash = requestId === null ? null : await digestRequest({ ...data, ledger });
      const current = await readCurrent(database, deviceId, now);
      const replay = replayResponse(current, requestId, requestHash, data.revision, request, requestBody);
      if (replay) return replay;
      if ((current?.revision ?? 0) !== data.revision || (current && current.generation !== data.generation)) return conflictResponse(current, request, requestBody);
      const previous = current ? decodeStored(current) : null;
      const finished = previous?.ledger.session;
      if (previous && finished?.endedAt !== undefined && ledger.session.startedAt === finished.startedAt && ledger.session.round === finished.round
        && JSON.stringify(ledger.session) !== JSON.stringify(restoreLedger(previous.ledger).session)) return errorResponse(problem('DOMAIN_RULE', '本局已结束，请新开一局，最终记录未修改', context('save ledger', 'ledger.session'), undefined), { method: request.method, url: request.url, body: requestBody, deviceId, requestId: request.headers.get('x-request-id') }, 400);
      const kept = prepareLedger(ledger, previous, now);
      const encoded = JSON.stringify({ ledger: kept.ledger, memberSeen: kept.memberSeen });
      const generation = current?.generation ?? crypto.randomUUID();
      const result = current
        ? await database.prepare('UPDATE device_ledgers SET data = ?, revision = revision + 1, updated_at = ?, cleanup_at = ?, last_request_id = ?, last_request_hash = ? WHERE device_id = ? AND revision = ? AND generation = ?')
          .bind(encoded, now, kept.cleanupAt, requestId, requestHash, deviceId, data.revision, generation).run()
        : await database.prepare('INSERT INTO device_ledgers (device_id, data, revision, generation, updated_at, cleanup_at, last_request_id, last_request_hash) VALUES (?, ?, 1, ?, ?, ?, ?, ?) ON CONFLICT(device_id) DO NOTHING')
          .bind(deviceId, encoded, generation, now, kept.cleanupAt, requestId, requestHash).run();
      if (!result.meta.changes) {
        const latest = await readCurrent(database, deviceId, now);
        return replayResponse(latest, requestId, requestHash, data.revision, request, requestBody) ?? conflictResponse(latest, request, requestBody);
      }
      return json({ ledger: kept.ledger, revision: data.revision + 1, generation }, 200);
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      const failure = isProblem(cause) ? cause : problem('INTERNAL', `接口处理失败：${cause.message}`, context('ledger API', null), cause);
      console.error(failureLog('ledger API', failure));
      return errorResponse(failure, { method: request.method, url: request.url, body: requestBody, deviceId, requestId: request.headers.get('x-request-id') }, failure.code === 'STORAGE' ? 503 : failure.code === 'VALIDATION' || failure.code === 'DOMAIN_RULE' ? 400 : 500);
    }
  },
};

function combineChunks(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  return raw;
}
function errorResponse(error: import('../shared/errors.ts').Problem, request: RequestDetails, status: number): Response {
  return json(errorBody(problem(error.code, error.message, { ...error.details, request, status }, error.cause instanceof Error ? error.cause : undefined)), status);
}

function rejected(request: Request, code: import('../shared/errors.ts').ProblemCode, message: string, status: number): Response {
  return errorResponse(problem(code, message, context('ledger API', null), undefined), { method: request.method, url: request.url, body: null, deviceId: request.headers.get('x-device-id'), requestId: request.headers.get('x-request-id') }, status);
}
function conflictResponse(row: DatabaseRow | null, request: Request, body: string | null): Response {
  const details = { ...context('save ledger', 'request.revision/generation'), request: { method: request.method, url: request.url, body, deviceId: request.headers.get('x-device-id'), requestId: request.headers.get('x-request-id') }, status: 409 };
  return json({ ...responseData(row), ...errorBody(problem('CONFLICT', `另一页面已更新记录或旧数据已清理，当前版本 ${row?.revision ?? 0}，已同步，请重试`, details, undefined)) }, 409);
}

// 摘要基于已验证模型；重复请求不修改版本、保留期限或最终结果。 Hash the validated model; replays never change revision, retention or final results.
async function digestRequest(data: import('../shared/types.ts').SaveRequest): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function replayResponse(row: DatabaseRow | null, requestId: string | null, requestHash: string | null, revision: number, request: Request, body: string | null): Response | null {
  if (requestId === null || row === null || row.last_request_id !== requestId) return null;
  if (row.last_request_hash !== requestHash) return errorResponse(problem('VALIDATION', 'X-Request-ID 已用于不同请求，请为新的写入生成新标识', context('save ledger', 'X-Request-ID'), undefined), { method: request.method, url: request.url, body, deviceId: row.device_id, requestId }, 400);
  return row.revision === revision + 1 ? json(responseData(row), 200) : conflictResponse(row, request, body);
}
