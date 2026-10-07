import type { StorageAdapter } from '../shared/types.ts';
import { context, problem } from '../shared/errors.ts';

// 本地存储错误保留操作和键名，不替换设备或静默丢弃备份。 Preserve storage operations and keys without replacing devices or silently discarding backups.
export function browserStorage(storage: StorageAdapter): StorageAdapter {
  const invoke = <T>(operation: string, key: string, value: string | null, execute: () => T): T => {
    try { return execute(); }
    catch (caught) {
      const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      throw problem('BROWSER', `浏览器存储 ${operation}(${key}) 失败：${cause.message}`, { ...context(`localStorage.${operation}`, key), request: { method: operation, url: 'browser:localStorage', body: JSON.stringify({ key, value }), deviceId: null } }, cause);
    }
  };
  return {
    getItem: key => invoke('getItem', key, null, () => storage.getItem(key)),
    setItem: (key, value) => invoke('setItem', key, value, () => storage.setItem(key, value)),
    removeItem: key => invoke('removeItem', key, null, () => storage.removeItem(key)),
  };
}
