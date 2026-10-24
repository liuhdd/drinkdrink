import type { ExternalValue, LedgerDatabase, SqlParameter } from '../shared/types.ts';
import type { CharadesNextRequest, CharadesSnapshot } from '../shared/charades.ts';
import { charadesNextRequestInput } from '../shared/charades.ts';
import { context, errorBody, isProblem, parseJson, problem, type Problem, type ProblemCode, type RequestDetails } from '../shared/errors.ts';
import { failureLog } from '../shared/logging.ts';
import { arrayInput, integerInput, required, textInput, uuidInput, invalid } from '../shared/validation.ts';
import { at } from '../shared/values.ts';
import { diagnosticDatabase } from './database.ts';
import { CHARADES_QUESTIONS } from './charades-questions.ts';

interface CharadesRow { deviceId: string; order: readonly string[]; drawn: number; round: number; revision: number; generation: string; lastRequestId: string | null; lastRequestHash: string | null; }
const columns = 'device_id, question_order, drawn, round, revision, generation, last_request_id, last_request_hash';
const json = (value: object, status: number): Response => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'X-Device-ID' } });

function rowInput(value: ExternalValue, sql: string, parameters: readonly SqlParameter[]): CharadesRow {
  try {
    const rawOrder = textInput(required(value, 'question_order', 'database'), 'database.question_order', 100_000);
    const order = arrayInput(parseJson(rawOrder, 'decode charades order'), 'database.question_order').map((id, index) => textInput(id, `database.question_order[${index}]`, 80));
    const ids = new Set(CHARADES_QUESTIONS.map(question => question.id));
    if (order.length !== ids.size || new Set(order).size !== order.length || order.some(id => !ids.has(id))) invalid('database.question_order', '包含完整题库且不重复的题目 ID', rawOrder);
    const rawRequestId = required(value, 'last_request_id', 'database'), rawHash = required(value, 'last_request_hash', 'database');
    const lastRequestId = rawRequestId === null ? null : uuidInput(rawRequestId, 'database.last_request_id');
    if (rawHash !== null && (typeof rawHash !== 'string' || !/^[a-f0-9]{64}$/.test(rawHash))) invalid('database.last_request_hash', 'SHA-256 摘要或 null', rawHash);
    if ((lastRequestId === null) !== (rawHash === null)) invalid('database.request', '同时存在或同时为空的请求标识与摘要', value);
    return { deviceId: uuidInput(required(value, 'device_id', 'database'), 'database.device_id'), order, drawn: integerInput(required(value, 'drawn', 'database'), 'database.drawn', 1, order.length), round: integerInput(required(value, 'round', 'database'), 'database.round', 1, Number.MAX_SAFE_INTEGER), revision: integerInput(required(value, 'revision', 'database'), 'database.revision', 1, Number.MAX_SAFE_INTEGER), generation: uuidInput(required(value, 'generation', 'database'), 'database.generation'), lastRequestId, lastRequestHash: rawHash };
  } catch (caught) {
    if (!(caught instanceof Error)) throw caught;
    throw problem('CORRUPT_STORAGE', `服务端出题进度损坏：${caught.message}`, { ...context('decode charades progress', isProblem(caught) ? caught.details.path : null), database: { sql, parameters }, responseBody: JSON.stringify(value) }, caught);
  }
}

async function readRow(db: LedgerDatabase, deviceId: string): Promise<CharadesRow | null> {
  const sql = `SELECT ${columns} FROM device_charades WHERE device_id = ?`;
  const value = await db.prepare(sql).bind(deviceId).first();
  return value === null ? null : rowInput(value, sql, [deviceId]);
}

function randomIndex(limit: number): number {
  const range = 0x1_0000_0000, ceiling = range - range % limit;
  const bytes = new Uint32Array(1);
  let value: number;
  do { crypto.getRandomValues(bytes); value = at(Array.from(bytes), 0); } while (value >= ceiling);
  return value % limit;
}

function shuffledOrder(previousId: string | null): readonly string[] {
  const order = CHARADES_QUESTIONS.map(question => question.id);
  for (let index = order.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1), value = at(order, index);
    order[index] = at(order, other);
    order[other] = value;
  }
  // 新一轮首题与上一轮末题错开；其余题目仍各出现一次。 Avoid repeating the last prompt at the round boundary; every prompt still appears once.
  if (order.length > 1 && previousId !== null && at(order, 0) === previousId) {
    const other = randomIndex(order.length - 1) + 1;
    order[0] = at(order, other);
    order[other] = previousId;
  }
  return order;
}

function snapshot(row: CharadesRow): CharadesSnapshot {
  const questionId = at(row.order, row.drawn - 1);
  const question = CHARADES_QUESTIONS.find(item => item.id === questionId);
  if (!question) throw problem('CORRUPT_STORAGE', `题库中不存在题目 ${questionId}`, context('read charades prompt', 'question.id'), undefined);
  return { question: { id: question.id, text: question.text, category: question.category }, revision: row.revision, generation: row.generation, round: row.round, drawn: row.drawn, total: row.order.length };
}

async function initialize(db: LedgerDatabase, deviceId: string): Promise<CharadesRow> {
  const current = await readRow(db, deviceId);
  if (current) return current;
  const order = shuffledOrder(null);
  if (order.length === 0) throw problem('INTERNAL', '你比划我猜题库为空，无法出题', context('initialize charades', null), undefined);
  await db.prepare('INSERT INTO device_charades (device_id, question_order, drawn, round, revision, generation) VALUES (?, ?, 1, 1, 1, ?) ON CONFLICT(device_id) DO NOTHING').bind(deviceId, JSON.stringify(order), crypto.randomUUID()).run();
  const created = await readRow(db, deviceId);
  if (!created) throw problem('STORAGE', '保存首题后未找到设备的出题进度，请检查 device_charades 表', context('initialize charades', null), undefined);
  return created;
}

function requestDetails(request: Request, body: string | null): RequestDetails {
  return { method: request.method, url: request.url, body, deviceId: request.headers.get('x-device-id'), requestId: request.headers.get('x-request-id') };
}
function failure(error: Problem, request: Request, body: string | null, status: number): Response {
  return json(errorBody(problem(error.code, error.message, { ...error.details, request: requestDetails(request, body), status }, error.cause instanceof Error ? error.cause : undefined)), status);
}
function rejected(request: Request, code: ProblemCode, message: string, status: number): Response {
  return failure(problem(code, message, context('charades API', null), undefined), request, null, status);
}
function conflict(row: CharadesRow | null, request: Request, body: string): Response {
  const error = problem('CONFLICT', '另一页面已切换题目，请重新连接以读取当前题目', { ...context('next charades prompt', 'request.revision/generation'), request: requestDetails(request, body), status: 409 }, undefined);
  return json({ ...(row ? snapshot(row) : {}), ...errorBody(error) }, 409);
}

function replay(row: CharadesRow | null, requestId: string, hash: string, data: CharadesNextRequest, request: Request, body: string): Response | null {
  if (row === null || row.lastRequestId !== requestId) return null;
  if (row.lastRequestHash !== hash) return failure(problem('VALIDATION', 'X-Request-ID 已用于不同请求，请为下一题生成新标识', context('next charades prompt', 'X-Request-ID'), undefined), request, body, 400);
  return row.revision === data.revision + 1 && row.generation === data.generation ? json(snapshot(row), 200) : conflict(row, request, body);
}

async function readBody(request: Request): Promise<string> {
  const maximum = 1024;
  if (Number(request.headers.get('content-length')) > maximum) throw problem('VALIDATION', '下一题请求超过 1024 字节', context('read charades request', 'request.body'), undefined);
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw problem('VALIDATION', '下一题请求超过 1024 字节', context('read charades request', 'request.body'), undefined); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function charadesApi(request: Request, rawDatabase: LedgerDatabase): Promise<Response> {
  const url = new URL(request.url), expectedMethod = url.pathname === '/api/charades' ? 'GET' : 'POST';
  if (request.method !== expectedMethod) return rejected(request, 'HTTP', `不支持请求方法 ${request.method}，请使用 ${expectedMethod}`, 405);
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.method === 'POST' && request.headers.get('origin') !== url.origin)) return rejected(request, 'HTTP', `请在本站使用工具，Origin 必须是 ${url.origin}`, 403);
  let body: string | null = null;
  try {
    const deviceId = uuidInput(request.headers.get('x-device-id'), 'X-Device-ID');
    const db = diagnosticDatabase(rawDatabase);
    if (request.method === 'GET') return json(snapshot(await initialize(db, deviceId)), 200);
    const requestId = uuidInput(request.headers.get('x-request-id'), 'X-Request-ID');
    if (!request.headers.get('content-type')?.startsWith('application/json')) return rejected(request, 'VALIDATION', '下一题格式无效，Content-Type 必须是 application/json', 400);
    body = await readBody(request);
    const data = charadesNextRequestInput(parseJson(body, 'decode charades next request'));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data)));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const current = await readRow(db, deviceId);
    const repeated = replay(current, requestId, hash, data, request, body);
    if (repeated) return repeated;
    if (!current || current.revision !== data.revision || current.generation !== data.generation) return conflict(current, request, body);
    const exhausted = current.drawn === current.order.length;
    const order = exhausted ? shuffledOrder(at(current.order, current.drawn - 1)) : current.order;
    const next = { ...current, order, drawn: exhausted ? 1 : current.drawn + 1, round: current.round + (exhausted ? 1 : 0), revision: current.revision + 1, lastRequestId: requestId, lastRequestHash: hash };
    const result = await db.prepare('UPDATE device_charades SET question_order = ?, drawn = ?, round = ?, revision = revision + 1, last_request_id = ?, last_request_hash = ? WHERE device_id = ? AND revision = ? AND generation = ?').bind(JSON.stringify(order), next.drawn, next.round, requestId, hash, deviceId, data.revision, data.generation).run();
    if (result.meta.changes) return json(snapshot(next), 200);
    const latest = await readRow(db, deviceId);
    return replay(latest, requestId, hash, data, request, body) ?? conflict(latest, request, body);
  } catch (caught) {
    const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
    const error = isProblem(cause) ? cause : problem('INTERNAL', `你比划我猜接口处理失败：${cause.message}`, context('charades API', null), cause);
    console.error(failureLog('charades API', error));
    return failure(error, request, body, error.code === 'STORAGE' ? 503 : error.code === 'VALIDATION' ? 400 : 500);
  }
}
