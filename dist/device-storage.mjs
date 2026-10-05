import { emptyLedger, restoreLedger } from './persistence.mjs';

export const STORAGE_KEY = 'cheers-ledger-v2';
export const LEGACY_STORAGE_KEY = 'cheers-ledger-v1';

export function loadDeviceLedger(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw !== null) {
    const data = JSON.parse(raw);
    if (!Number.isSafeInteger(data?.revision) || data.revision < 1) throw new Error('本机记录版本无效');
    return { ledger: restoreLedger(data.ledger), revision: data.revision };
  }
  const legacy = storage.getItem(LEGACY_STORAGE_KEY);
  return { ledger: legacy === null ? emptyLedger() : restoreLedger(JSON.parse(legacy)), revision: 0 };
}

export function saveDeviceLedger(storage, ledger, expectedRevision) {
  const current = loadDeviceLedger(storage);
  if (current.revision !== expectedRevision) {
    const error = new Error('本机另一页面已更新记录，已同步，请重试');
    error.data = current;
    throw error;
  }
  const next = { ledger: restoreLedger(ledger), revision: current.revision + 1 };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
