import { decodeSnapshot } from '../shared/protocol.ts';
import type { ExternalValue, DeviceOptions, DeviceClient, Snapshot, Ledger, SaveRequest } from '../shared/types.ts';
import { field, errorSnapshot } from '../shared/values.ts';
import { emptyLedger, restoreLedger } from '../shared/persistence.ts';
import { loadDeviceLedger, STORAGE_KEY, LEGACY_STORAGE_KEY } from './device-storage.ts';

export const DEVICE_KEY = 'cheers-device-id-v1';
export const MIGRATION_KEY = 'cheers-server-migrated-v1';
export const SYNC_KEY = 'cheers-server-sync-v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createDeviceClient({ storage, fetch: request, randomUUID }: DeviceOptions): DeviceClient {
  let deviceId: string | undefined;
  const identify = () => {
    if (deviceId) return deviceId;
    const storedId = storage.getItem(DEVICE_KEY);
    const nextId = storedId !== null && uuid.test(storedId) ? storedId : randomUUID();
    if (nextId !== storedId) storage.setItem(DEVICE_KEY, nextId);
    deviceId = nextId;
    return deviceId;
  };
  const call = async (method: string, body: SaveRequest | undefined): Promise<Snapshot> => {
    let response: Response;
    try {
      response = await request('/api/ledger', { method, cache: 'no-store', credentials: 'same-origin',
        headers: { 'X-Device-ID': identify(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('无法连接记录服务，输入已保留，请检查网络后重试'); }
    const data: ExternalValue = await response.json();
    if (!response.ok) {
      const error = Object.assign(new Error(String(field(data, 'error') || '服务端保存失败，请重试')), { data: response.status === 409 ? decodeSnapshot(data) : null });
      throw error;
    }
    return decodeSnapshot(data);
  };
  const finishMigration = () => {
    // 本地清理失败不能将成功的服务端保存报告为失败。 A successful server write must not be reported as failed if local housekeeping fails.
    try {
      storage.setItem(MIGRATION_KEY, identify());
      storage.removeItem(STORAGE_KEY);
      storage.removeItem(LEGACY_STORAGE_KEY);
    } catch { /* 浏览器存储只读时保留本地备份。 Keep a local backup when browser storage is read-only. */ }
  };
  const save = async (ledger: Ledger, revision: number, generation: string | null): Promise<Snapshot> => {
    const data = await call('PUT', { ledger: restoreLedger(ledger), revision, generation });
    finishMigration();
    try { storage.setItem(SYNC_KEY, randomUUID()); } catch { /* 重新聚焦时的同步也会检查服务端。 Focus synchronization also checks the server. */ }
    return data;
  };
  return {
    load: () => call('GET', undefined), save,
    async initialize() {
      let data = await call('GET', undefined);
      if (!data.ledger) {
        const initial = storage.getItem(MIGRATION_KEY) === identify() ? emptyLedger(Date.now()) : loadDeviceLedger(storage).ledger;
        try { data = await save(initial, 0, null); }
        catch (error) { const conflict = error instanceof Error ? errorSnapshot(error) : null; if (!conflict?.ledger) throw error; data = conflict; }
      }
      finishMigration();
      return data;
    },
  };
}
