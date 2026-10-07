import { decodeSnapshot } from '../shared/protocol.ts';
import type { ExternalValue, DeviceOptions, DeviceClient, Snapshot, Ledger, SaveRequest, ClientResult } from '../shared/types.ts';
import { field } from '../shared/values.ts';
import { context, problem, parseJson, isProblemCode, isProblem } from '../shared/errors.ts';
import { uuidInput } from '../shared/validation.ts';
import { browserStorage } from './storage.ts';
import { emptyLedger, restoreLedger } from '../shared/persistence.ts';
import { loadDeviceLedger, STORAGE_KEY, LEGACY_STORAGE_KEY } from './device-storage.ts';

export const DEVICE_KEY = 'cheers-device-id-v1';
export const MIGRATION_KEY = 'cheers-server-migrated-v1';
export const SYNC_KEY = 'cheers-server-sync-v1';

export function createDeviceClient({ storage: suppliedStorage, fetch: request, randomUUID }: DeviceOptions): DeviceClient {
  const storage = browserStorage(suppliedStorage);
  let deviceId: string | undefined;
  const identify = (): string => {
    if (deviceId) return deviceId;
    const storedId = storage.getItem(DEVICE_KEY);
    const nextId = storedId === null ? randomUUID() : uuidInput(storedId, DEVICE_KEY);
    if (nextId !== storedId) storage.setItem(DEVICE_KEY, nextId);
    deviceId = nextId;
    return deviceId;
  };
  const call = async (method: string, body: SaveRequest | undefined): Promise<Snapshot> => {
    const device = identify();
    const serialized = body === undefined ? null : JSON.stringify(body);
    const details = { ...context('ledger API', null), request: { method, url: '/api/ledger', body: serialized, deviceId: device } };
    let response: Response;
    try {
      response = await request('/api/ledger', { method, cache: 'no-store', credentials: 'same-origin', headers: { 'X-Device-ID': device, ...(serialized === null ? {} : { 'Content-Type': 'application/json' }) }, ...(serialized === null ? {} : { body: serialized }), signal: AbortSignal.timeout(15000) });
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      throw problem('NETWORK', `无法连接记录服务（${method} /api/ledger）：${cause.message}。输入已保留，请检查网络后重试`, details, cause);
    }
    let text: string;
    try { text = await response.text(); }
    catch (caught) {
      const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      throw problem('NETWORK', `读取记录服务响应失败（HTTP ${response.status}）：${cause.message}`, { ...details, status: response.status }, cause);
    }
    const responseDetails = { ...details, status: response.status, responseBody: text };
    let data: ExternalValue;
    try { data = parseJson(text, 'decode API response'); }
    catch (caught) {
      if (!(caught instanceof Error)) throw caught;
      throw problem(response.ok ? 'RESPONSE' : 'HTTP', `记录服务响应格式无效（HTTP ${response.status}）：${caught.message}`, responseDetails, caught);
    }
    if (!response.ok) {
      const message = field(data, 'error');
      if (typeof message !== 'string' || !message) throw problem('RESPONSE', `错误响应缺少具体原因（HTTP ${response.status}）`, responseDetails, undefined);
      const path = field(field(data, 'details'), 'path');
      const code = field(data, 'code');
      if (!isProblemCode(code)) throw problem('RESPONSE', `错误响应缺少有效错误码（HTTP ${response.status}）`, responseDetails, undefined);
      const remoteCause = field(data, 'cause');
      const causeMessage = field(remoteCause, 'message'), causeName = field(remoteCause, 'name');
      if (remoteCause !== null && remoteCause !== undefined && (typeof causeMessage !== 'string' || typeof causeName !== 'string')) throw problem('RESPONSE', '服务端错误原因结构无效', responseDetails, undefined);
      const cause = typeof causeMessage === 'string' && typeof causeName === 'string' ? Object.assign(new Error(causeMessage), { name: causeName }) : undefined;
      let conflict: Snapshot | null = null;
      if (response.status === 409) {
        try { conflict = decodeSnapshot(data); }
        catch (caught) {
          if (!(caught instanceof Error)) throw caught;
          throw problem('RESPONSE', `冲突响应账本无效：${caught.message}`, responseDetails, caught);
        }
      }
      throw Object.assign(problem(code, `${method} /api/ledger 失败（HTTP ${response.status}）：${message}`, { ...responseDetails, path: typeof path === 'string' ? path : null }, cause), { data: conflict });
    }
    try { return decodeSnapshot(data); }
    catch (caught) {
      if (!(caught instanceof Error)) throw caught;
      throw problem('RESPONSE', `记录服务返回无效账本（HTTP ${response.status}）：${caught.message}`, responseDetails, caught);
    }
  };
  const finishMigration = (): void => {
    storage.setItem(MIGRATION_KEY, identify());
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(LEGACY_STORAGE_KEY);
  };
  const localResult = (snapshot: Snapshot, execute: () => void): ClientResult => {
    try { execute(); return { snapshot, localError: null }; }
    catch (caught) {
      const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      const details = isProblem(cause) ? cause.details : context('local maintenance', null);
      return { snapshot, localError: problem('BROWSER', `账本已在服务端保存，但本地维护失败：${cause.message}。请修复存储权限后重试本地维护。`, details, cause) };
    }
  };
  const maintainSavedLedger = (): void => { finishMigration(); storage.setItem(SYNC_KEY, randomUUID()); };
  const save = async (ledger: Ledger, revision: number, generation: string | null): Promise<ClientResult> => {
    const data = await call('PUT', { ledger: restoreLedger(ledger), revision, generation });
    return localResult(data, maintainSavedLedger);
  };
  return {
    load: () => call('GET', undefined), save,
    async initialize() {
      const data = await call('GET', undefined);
      if (!data.ledger) {
        const initial = storage.getItem(MIGRATION_KEY) === identify() ? emptyLedger(Date.now()) : loadDeviceLedger(storage).ledger;
        return save(initial, 0, null);
      }
      return localResult(data, finishMigration);
    },
    async repairLocalStorage() {
      const snapshot = await call('GET', undefined);
      if (snapshot.ledger === null) throw problem('BROWSER', '服务端记录已清理，请重新加载页面；本地备份未删除', context('repair local storage', null), undefined);
      maintainSavedLedger();
      return snapshot;
    },
  };
}
