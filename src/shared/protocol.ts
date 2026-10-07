import type { ExternalValue, Snapshot } from './types.ts';
import { field } from './values.ts';
import { restoreLedger } from './persistence.ts';

export function decodeSnapshot(data: ExternalValue): Snapshot {
  const revision = field(data, 'revision'), ledger = field(data, 'ledger'), generation = field(data, 'generation');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof revision !== 'number' || (generation !== null && typeof generation !== 'string') || !Number.isSafeInteger(revision) || revision < 0 || (revision > 0 && (!ledger || !uuid.test(String(generation ?? '')))) || (revision === 0 && (ledger !== null || generation !== null))) throw new Error('服务端返回的记录无效，请重试');
  return { ledger: ledger === null ? null : restoreLedger(ledger), revision, generation };
}
