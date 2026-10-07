import { domainError } from './errors.ts';
import { required, integerInput, invalid, uuidInput } from './validation.ts';
import type { ExternalValue, Snapshot, SaveRequest } from './types.ts';
import { field } from './values.ts';
import { restoreLedger } from './persistence.ts';

export function decodeSnapshot(data: ExternalValue): Snapshot {
  const revision = integerInput(required(data, 'revision', 'response'), 'response.revision', 0, Number.MAX_SAFE_INTEGER);
  const rawLedger = required(data, 'ledger', 'response'), rawGeneration = required(data, 'generation', 'response');
  if (revision === 0) {
    if (rawLedger !== null) invalid('response.ledger', '空版本对应的 null', rawLedger);
    if (rawGeneration !== null) invalid('response.generation', '空版本对应的 null', rawGeneration);
    return { ledger: null, revision: 0, generation: null };
  }
  const generation = uuidInput(rawGeneration, 'response.generation');
  return { ledger: restoreLedger(rawLedger), revision, generation };
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
