import type { LegacyStorage, Ledger, DeviceLedger } from '../shared/types.ts';
import { field } from '../shared/values.ts';
import { emptyLedger, restoreLedger, migrateLegacyLedger } from '../shared/persistence.ts';

export const STORAGE_KEY = 'cheers-ledger-v2';
export const LEGACY_STORAGE_KEY = 'cheers-ledger-v1';

export function loadDeviceLedger(storage: LegacyStorage): DeviceLedger {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw !== null) {
    const data: import('../shared/types.ts').ExternalValue = JSON.parse(raw);
    const revision = field(data, 'revision');
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) throw new Error('本机记录版本无效');
    return { ledger: restoreLedger(field(data, 'ledger')), revision };
  }
  const legacy = storage.getItem(LEGACY_STORAGE_KEY);
  return { ledger: legacy === null ? emptyLedger(Date.now()) : migrateLegacyLedger(JSON.parse(legacy)), revision: 0 };
}

export function saveDeviceLedger(storage: LegacyStorage, ledger: Ledger, expectedRevision: number): DeviceLedger {
  const current = loadDeviceLedger(storage);
  if (current.revision !== expectedRevision) {
    const error = Object.assign(new Error('本机另一页面已更新记录，已同步，请重试'), { data: current });
    throw error;
  }
  const next = { ledger: restoreLedger(ledger), revision: current.revision + 1 };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
