import { context, problem, isProblem } from '../shared/errors.ts';
import type { ExternalValue, DatabaseRow, MemberSeen, StoredLedger } from '../shared/types.ts';
import { field, list } from '../shared/values.ts';
import { required, integerInput, timestampInput, uuidInput, textInput, objectInput } from '../shared/validation.ts';
import { restoreLedger } from '../shared/persistence.ts';

export function databaseRow(value: ExternalValue): DatabaseRow {
  return { device_id: uuidInput(required(value, 'device_id', 'database'), 'database.device_id'), data: textInput(required(value, 'data', 'database'), 'database.data', Number.MAX_SAFE_INTEGER), revision: integerInput(required(value, 'revision', 'database'), 'database.revision', 1, Number.MAX_SAFE_INTEGER), generation: uuidInput(required(value, 'generation', 'database'), 'database.generation'), updated_at: timestampInput(required(value, 'updated_at', 'database'), 'database.updated_at'), cleanup_at: timestampInput(required(value, 'cleanup_at', 'database'), 'database.cleanup_at') };
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
