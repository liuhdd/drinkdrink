'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { APPEARANCE_STORAGE_KEY, loadAppearanceSettings, saveAppearanceSettings } from '@/client/appearance-storage';
import { DEFAULT_APPEARANCE, type AppearanceSettings } from '@/shared/appearance';
import { context, problem } from '@/shared/errors';
import { failureLog } from '@/shared/logging';

export interface AppearanceController {
  settings: AppearanceSettings;
  ready: boolean;
  error: string;
  update: (next: AppearanceSettings) => void;
  restoreDefaults: () => void;
  reload: () => void;
}

export function useAppearance(): AppearanceController {
  const [settings, setSettings] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const loaded = useRef(false);
  const loadError = useRef<Error | undefined>(undefined);
  const report = useCallback((operation: string, caught: unknown) => {
    const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
    console.error(failureLog(operation, cause));
    setError(cause.message);
    return cause;
  }, []);
  const reload = useCallback(() => {
    try {
      const next = loadAppearanceSettings(localStorage);
      loaded.current = true;
      loadError.current = undefined;
      setSettings(next);
      setError('');
    } catch (caught) {
      loaded.current = false;
      loadError.current = report('load appearance settings', caught);
    } finally { setReady(true); }
  }, [report]);
  const persist = useCallback((next: AppearanceSettings) => {
    try {
      const saved = saveAppearanceSettings(localStorage, next);
      loaded.current = true;
      loadError.current = undefined;
      setSettings(saved);
      setReady(true);
      setError('');
    } catch (caught) { report('save appearance settings', caught); }
  }, [report]);
  const update = useCallback((next: AppearanceSettings) => {
    if (!loaded.current) {
      report('save appearance settings', problem('BROWSER', '外观设置尚未成功读取，请先重新加载或恢复默认外观', context('save appearance settings', APPEARANCE_STORAGE_KEY), loadError.current));
      return;
    }
    persist(next);
  }, [persist, report]);
  const restoreDefaults = useCallback(() => persist(DEFAULT_APPEARANCE), [persist]);
  useEffect(() => {
    reload();
    const storageChanged = (event: StorageEvent) => { if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) reload(); };
    window.addEventListener('storage', storageChanged);
    return () => window.removeEventListener('storage', storageChanged);
  }, [reload]);
  useEffect(() => {
    // 更新框架生成的唯一标签，浏览器顶栏随本地配色同步。 Update the framework's single meta tag so browser chrome follows the local palette.
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!themeColor) {
      report('apply browser theme', problem('BROWSER', '无法应用浏览器顶栏配色：页面缺少 theme-color 元数据', context('apply browser theme', 'meta[name="theme-color"]'), undefined));
      return;
    }
    themeColor.content = settings.global.colors.background;
  }, [settings.global.colors.background, report]);
  return { settings, ready, error, update, restoreDefaults, reload };
}
