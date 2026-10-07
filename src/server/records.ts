import { context, problem, isProblem, validationError } from '../shared/errors.ts';
import type { ExternalValue, DatabaseRow, MemberSeen, StoredLedger } from '../shared/types.ts';
import { field, list } from '../shared/values.ts';
import { required, integerInput, timestampInput, uuidInput, textInput, objectInput } from '../shared/validation.ts';
import { restoreLedger } from '../shared/persistence.ts';

export function databaseRow(value: ExternalValue): DatabaseRow {
  const requestId = required(value, 'last_request_id', 'database'), requestHash = required(value, 'last_request_hash', 'database');
  const last_request_id = requestId === null ? null : uuidInput(requestId, 'database.last_request_id');
  if (requestHash !== null && (typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(requestHash))) throw validationError('database.last_request_hash', 'SHA-256 摘要或 null', requestHash);
  if ((last_request_id === null) !== (requestHash === null)) throw validationError('database.request', '同时存在或同时为空的请求标识与摘要', value);
  return { last_request_id, last_request_hash: requestHash, device_id: uuidInput(required(value, 'device_id', 'database'), 'database.device_id'), data: textInput(required(value, 'data', 'database'), 'database.data', Number.MAX_SAFE_INTEGER), revision: integerInput(required(value, 'revision', 'database'), 'database.revision', 1, Number.MAX_SAFE_INTEGER), generation: uuidInput(required(value, 'generation', 'database'), 'database.generation'), updated_at: timestampInput(required(value, 'updated_at', 'database'), 'database.updated_at'), cleanup_at: timestampInput(required(value, 'cleanup_at', 'database'), 'database.cleanup_at') };
}
export function memberSeen(value: ExternalValue): MemberSeen {
  const record = objectInput(value, 'database.memberSeen');
  return Object.fromEntries(Object.keys(record).map(key => [key, timestampInput(field(record, key), `database.memberSeen.${key}`)]));
}
export function storedLedger(value: ExternalValue): StoredLedger {
  return { ledger: restoreLedger(required(value, 'ledger', 'database')), memberSeen: memberSeen(required(value, 'memberSeen', 'database')) };
}

export function rowInput(value: ExternalValue, sql: string, parameters: readonly import('../shared/types.ts').SqlParameter[]): DatabaseRow {
  try { return databaseRow(value); }
  catch (caught) {
    if (!(caught instanceof Error)) throw caught;
    throw problem('CORRUPT_STORAGE', `数据库元数据损坏：${caught.message}`, { ...context('decode database row', isProblem(caught) ? caught.details.path : null), database: { sql, parameters }, responseBody: JSON.stringify(value) }, caught);
  }
}
