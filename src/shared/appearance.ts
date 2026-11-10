export interface AppearanceColors {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  secondary: string;
  border: string;
  input: string;
}

export interface AppearanceValues {
  fontScale: number;
  radiusScale: number;
  surfaceOpacity: number;
  blur: number;
  buttonScale: number;
  colors: AppearanceColors;
}

export const APPEARANCE_REGIONS = [
  { id: 'app-header', label: '顶部导航', page: 'shared' },
  { id: 'navigation', label: '底部导航', page: 'shared' },
  { id: 'members', label: '酒友列表', page: 'ledger' },
  { id: 'member-controls', label: '酒友操作', page: 'ledger' },
  { id: 'activity', label: '最近记录', page: 'ledger' },
  { id: 'ranking', label: '排行榜', page: 'ranking' },
  { id: 'ranking-totals', label: '排行总计', page: 'ranking' },
  { id: 'history', label: '历史列表', page: 'history' },
  { id: 'history-details', label: '历史详情', page: 'history' },
  { id: 'tools', label: '工具入口', page: 'tools' },
  { id: 'dice', label: '摇骰子', page: 'tools' },
  { id: 'dice-settings', label: '骰子数量弹窗', page: 'tools' },
  { id: 'guandan', label: '掼蛋', page: 'tools' },
  { id: 'charades', label: '你比划我猜', page: 'tools' },
  { id: 'session-settings', label: '对局设置', page: 'settings' },
  { id: 'new-session', label: '开启新一局', page: 'settings' },
  { id: 'member-dialog', label: '成员与结束弹窗', page: 'settings' },
  { id: 'summary', label: '总结弹窗', page: 'settings' },
  { id: 'settings-menu', label: '设置入口', page: 'settings' },
] as const;

export type AppearanceRegionId = typeof APPEARANCE_REGIONS[number]['id'];
export type AppearancePageId = typeof APPEARANCE_REGIONS[number]['page'];
export interface AppearanceSettings {
  version: 1;
  global: AppearanceValues;
  regions: Partial<Record<AppearanceRegionId, AppearanceValues>>;
}

export const DEFAULT_APPEARANCE_VALUES: AppearanceValues = {
  fontScale: 100,
  radiusScale: 100,
  surfaceOpacity: 100,
  blur: 0,
  buttonScale: 100,
  colors: {
    background: '#fffaf3', surface: '#ffffff', text: '#30221c', muted: '#78685e',
    accent: '#bb4200', secondary: '#ffecd7', border: '#eee3d8', input: '#dfcdbd',
  },
};
export const DEFAULT_APPEARANCE: AppearanceSettings = { version: 1, global: DEFAULT_APPEARANCE_VALUES, regions: {} };

export function regionAppearance(settings: AppearanceSettings, id: AppearanceRegionId): AppearanceValues {
  return settings.regions[id] ?? settings.global;
}

function invalid(path: string, expected: string, value: unknown): TypeError {
  return Object.assign(new TypeError(`外观设置格式无效：${path} 必须是${expected}，收到 ${String(value)}`), { name: 'AppearanceValidationError' });
}

// 外部数据只在解析边界保留未知类型，返回完整且经过校验的模型。 Keep unknown values at the parsing boundary and return a complete validated model.
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(path, '对象', value);
  return value as Record<string, unknown>;
}

function number(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw invalid(path, `${minimum} 至 ${maximum} 之间的有限数字`, value);
  return value;
}

function color(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) throw invalid(path, '#rrggbb 颜色', value);
  return value.toLowerCase();
}

function colors(value: unknown, path: string): AppearanceColors {
  const data = object(value, path);
  return {
    background: color(data.background, `${path}.background`), surface: color(data.surface, `${path}.surface`),
    text: color(data.text, `${path}.text`), muted: color(data.muted, `${path}.muted`),
    accent: color(data.accent, `${path}.accent`), secondary: color(data.secondary, `${path}.secondary`),
    border: color(data.border, `${path}.border`), input: color(data.input, `${path}.input`),
  };
}

function values(value: unknown, path: string): AppearanceValues {
  const data = object(value, path);
  return {
    fontScale: number(data.fontScale, `${path}.fontScale`, 75, 150),
    radiusScale: number(data.radiusScale, `${path}.radiusScale`, 0, 200),
    surfaceOpacity: number(data.surfaceOpacity, `${path}.surfaceOpacity`, 0, 100),
    blur: number(data.blur, `${path}.blur`, 0, 24),
    buttonScale: number(data.buttonScale, `${path}.buttonScale`, 80, 130),
    colors: colors(data.colors, `${path}.colors`),
  };
}

export function parseAppearanceSettings(input: unknown): AppearanceSettings {
  const data = object(input, 'appearance');
  if (data.version !== 1) throw invalid('appearance.version', '版本号 1', data.version);
  const global = values(data.global, 'appearance.global');
  const regionData = object(data.regions, 'appearance.regions');
  const regions = APPEARANCE_REGIONS.reduce<AppearanceSettings['regions']>((result, region) => {
    if (!Object.hasOwn(regionData, region.id)) return result;
    return { ...result, [region.id]: values(regionData[region.id], `appearance.regions.${region.id}`) };
  }, {});
  return { version: 1, global, regions };
}
