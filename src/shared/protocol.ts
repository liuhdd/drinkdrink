import { required, integerInput, invalid } from './validation.ts';
import type { ExternalValue, Snapshot, SaveRequest } from './types.ts';
import { field } from './values.ts';
import { restoreLedger } from './persistence.ts';

export function decodeSnapshot(data: ExternalValue): Snapshot {
  const revision = required(data, 'revision', 'response'), ledger = required(data, 'ledger', 'response'), generation = required(data, 'generation', 'response');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof revision !== 'number' || (generation !== null && typeof generation !== 'string') || !Number.isSafeInteger(revision) || revision < 0 || (revision > 0 && (!ledger || !uuid.test(String(generation ?? '')))) || (revision === 0 && (ledger !== null || generation !== null))) throw new Error('服务端返回的记录无效，请重试');
  if (ledger !== null && required(ledger, 'version', 'response.ledger') !== 2) invalid('response.ledger.version', '版本 2', field(ledger, 'version'));
  return { ledger: ledger === null ? null : restoreLedger(ledger), revision, generation };
}

export function saveRequestInput(value: ExternalValue, now: number): SaveRequest {
  const revision = integerInput(required(value, 'revision', 'request'), 'request.revision', 0, Number.MAX_SAFE_INTEGER);
  const generation = required(value, 'generation', 'request');
  const rawLedger = required(value, 'ledger', 'request');
  if (required(rawLedger, 'version', 'ledger') !== 2) invalid('ledger.version', '版本 2', field(rawLedger, 'version'));
  if (revision === 0 ? generation !== null : typeof generation !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generation)) invalid('request.generation', '与版本一致的账本代际标识', generation);
  if (generation !== null && typeof generation !== 'string') invalid('request.generation', '字符串或 null', generation);
  const ledger = restoreLedger(rawLedger);
  const dates = [ledger.session.startedAt, ...(ledger.session.endedAt === undefined ? [] : [ledger.session.endedAt]), ...ledger.session.events.map(event => event.at), ...ledger.history.flatMap(entry => [entry.endedAt, entry.session.startedAt, ...entry.session.events.map(event => event.at)])];
  if (dates.some(at => at > now + 5 * 60 * 1000)) invalid('ledger.timestamps', '不超过当前时间 5 分钟的时间', value);
  return { ledger, revision, generation };
}

export function errorSnapshot(error: Error): Snapshot | null {
  const data = field(error, 'data');
  return data === null || data === undefined ? null : decodeSnapshot(data);
}
