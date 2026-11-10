import { DEFAULT_APPEARANCE, parseAppearanceSettings, type AppearanceSettings } from '../shared/appearance.ts';
import { context, isProblem, parseJson, problem } from '../shared/errors.ts';

export const APPEARANCE_STORAGE_KEY = 'cheers-appearance-v1';
export type AppearanceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadAppearanceSettings(storage: AppearanceStorage): AppearanceSettings {
  let raw: string | null;
  try { raw = storage.getItem(APPEARANCE_STORAGE_KEY); }
  catch (caught) {
    if (!(caught instanceof Error)) throw caught;
    throw problem('BROWSER', `无法读取浏览器外观设置（${APPEARANCE_STORAGE_KEY}）：${caught.message}。请允许网站存储后重新加载`, context('load appearance settings', APPEARANCE_STORAGE_KEY), caught);
  }
  if (raw === null) return parseAppearanceSettings(DEFAULT_APPEARANCE);
  try { return parseAppearanceSettings(parseJson(raw, 'decode appearance settings')); }
  catch (caught) {
    if (!(caught instanceof Error) || !(caught.name === 'AppearanceValidationError' || (isProblem(caught) && caught.code === 'VALIDATION'))) throw caught;
    throw problem('CORRUPT_STORAGE', `浏览器外观设置损坏（${APPEARANCE_STORAGE_KEY}）：${caught.message}。原记录未修改，请重新加载或恢复默认外观`, { ...context('decode appearance settings', APPEARANCE_STORAGE_KEY), responseBody: raw }, caught);
  }
}

export function saveAppearanceSettings(storage: AppearanceStorage, settings: AppearanceSettings): AppearanceSettings {
  const next = parseAppearanceSettings(settings);
  try { storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next)); }
  catch (caught) {
    if (!(caught instanceof Error)) throw caught;
    throw problem('BROWSER', `无法保存浏览器外观设置（${APPEARANCE_STORAGE_KEY}）：${caught.message}。请检查网站存储权限及可用空间后重试`, context('save appearance settings', APPEARANCE_STORAGE_KEY), caught);
  }
  return next;
}
