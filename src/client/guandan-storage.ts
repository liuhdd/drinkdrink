import { parseGuandanGame, type Game } from '../shared/guandan.ts';

export const GUANDAN_STORAGE_KEY = 'cheers-guandan-v1';
export type GuandanStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadGuandanGame(storage: GuandanStorage): { game: Game | null; raw: string | null } {
  const raw = storage.getItem(GUANDAN_STORAGE_KEY);
  if (raw === null) return { game: null, raw };
  try { return { game: parseGuandanGame(JSON.parse(raw) as unknown), raw }; }
  catch (cause) {
    throw Object.assign(new Error(`掼蛋练习记录无法读取：${cause instanceof Error ? cause.message : String(cause)}。原记录未修改，请重试读取，或确认重新开局。`, { cause }), { name: 'GuandanStorageError' });
  }
}

/** 保存前检查其他页面的进度，不用旧手牌覆盖新状态。 Check other tabs before saving so stale hands cannot overwrite newer progress. */
export function saveGuandanGame(storage: GuandanStorage, game: Game, expected: string | null): string {
  if (storage.getItem(GUANDAN_STORAGE_KEY) !== expected) {
    throw Object.assign(new Error('另一个页面已更新掼蛋牌局，请重新读取后继续。'), { name: 'GuandanStorageConflictError' });
  }
  const raw = JSON.stringify(parseGuandanGame(game));
  try { storage.setItem(GUANDAN_STORAGE_KEY, raw); }
  catch (cause) {
    throw Object.assign(new Error('掼蛋牌局未保存，请检查浏览器存储权限或空间后重试。当前手牌没有改变。', { cause }), { name: 'GuandanStorageError' });
  }
  return raw;
}
