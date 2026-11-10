import type { CSSProperties } from 'react';
import { APPEARANCE_REGIONS, DEFAULT_APPEARANCE_VALUES, regionAppearance, type AppearanceSettings, type AppearanceValues } from '../shared/appearance.ts';

type AppearanceVariable = '--background' | '--card' | '--foreground' | '--muted-foreground' | '--primary' | '--primary-foreground' | '--secondary' | '--muted' | '--accent' | '--accent-foreground' | '--border' | '--input' | '--ring' | '--signal' | '--signal-foreground' | '--appearance-text-scale' | '--appearance-button-scale' | '--appearance-surface-opacity' | '--appearance-backdrop-filter' | '--appearance-radius-sm' | '--appearance-radius-md' | '--appearance-radius-lg' | '--appearance-radius-xl' | '--radius-2xl' | '--radius-3xl' | '--radius-4xl' | '--text-xs' | '--text-sm' | '--text-base' | '--text-lg' | '--text-xl' | '--text-2xl' | '--text-3xl' | '--text-4xl' | '--text-5xl' | '--text-6xl' | '--text-7xl' | '--text-8xl' | '--text-9xl' | '--appearance-game-header-height' | '--appearance-game-action-height';
export type AppearanceVariables = CSSProperties & Record<AppearanceVariable | '--destructive' | '--destructive-foreground', string>;

function foregroundFor(background: string): string {
  const channels = [background.slice(1, 3), background.slice(3, 5), background.slice(5, 7)].map(channel => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

/** 完整变量让每个区域独立继承，也供预览直接使用。 Complete variables isolate each region and can be used directly by previews. */
export function appearanceVariables(values: AppearanceValues): AppearanceVariables {
  const font = values.fontScale / 100;
  const radius = values.radiusScale / 100;
  const button = values.buttonScale / 100;
  const colors = values.colors;
  const signal = colors.accent === DEFAULT_APPEARANCE_VALUES.colors.accent ? '#ef6b1a' : colors.accent;
  // 深色表面使用明红色提示，危险按钮的文字仍按底色计算。 Use a light red on dark surfaces and derive readable text for destructive buttons.
  const destructive = foregroundFor(colors.surface) === '#ffffff' ? '#ff8a80' : '#b6322b';
  return {
    '--background': colors.background, '--card': colors.surface, '--foreground': colors.text,
    '--muted-foreground': colors.muted, '--primary': colors.accent, '--primary-foreground': foregroundFor(colors.accent),
    '--secondary': colors.secondary,
    '--muted': colors.background === DEFAULT_APPEARANCE_VALUES.colors.background ? '#f7f0e8' : `color-mix(in srgb, ${colors.background} 85%, ${colors.text})`,
    '--accent': colors.secondary === DEFAULT_APPEARANCE_VALUES.colors.secondary && colors.background === DEFAULT_APPEARANCE_VALUES.colors.background ? '#fff0df' : `color-mix(in srgb, ${colors.secondary} 75%, ${colors.background})`,
    '--accent-foreground': colors.text, '--border': colors.border, '--input': colors.input, '--ring': colors.accent,
    '--destructive': destructive, '--destructive-foreground': foregroundFor(destructive),
    '--signal': signal, '--signal-foreground': signal === '#ef6b1a' ? '#30221c' : foregroundFor(signal),
    '--appearance-text-scale': `${font}`, '--appearance-button-scale': `${button}`,
    '--appearance-surface-opacity': `${values.surfaceOpacity}%`,
    '--appearance-backdrop-filter': values.blur === 0 ? 'none' : `blur(${values.blur}px)`,
    '--appearance-radius-sm': `calc(0.5rem * ${radius})`, '--appearance-radius-md': `calc(0.75rem * ${radius})`,
    '--appearance-radius-lg': `calc(0.875rem * ${radius})`, '--appearance-radius-xl': `calc(1rem * ${radius})`,
    '--radius-2xl': `calc(1rem * ${radius})`, '--radius-3xl': `calc(1.5rem * ${radius})`, '--radius-4xl': `calc(2rem * ${radius})`,
    '--text-xs': `calc(0.75rem * ${font})`, '--text-sm': `calc(0.875rem * ${font})`, '--text-base': `calc(1rem * ${font})`,
    '--text-lg': `calc(1.125rem * ${font})`, '--text-xl': `calc(1.25rem * ${font})`, '--text-2xl': `calc(1.5rem * ${font})`,
    '--text-3xl': `calc(1.875rem * ${font})`, '--text-4xl': `calc(2.25rem * ${font})`, '--text-5xl': `calc(3rem * ${font})`,
    '--text-6xl': `calc(3.75rem * ${font})`, '--text-7xl': `calc(4.5rem * ${font})`, '--text-8xl': `calc(6rem * ${font})`, '--text-9xl': `calc(8rem * ${font})`,
    '--appearance-game-header-height': `calc(max(2.75rem * ${button}, 1.75rem * ${font}) + 1.5rem + 1px)`,
    '--appearance-game-action-height': `calc(3rem * ${button} + 1.25rem + 1px)`,
  };
}

function declarations(values: AppearanceValues): string {
  return Object.entries(appearanceVariables(values)).map(([name, value]) => `${name}:${value}`).join(';');
}

/** 只把已验证模型中的颜色与数值写入固定选择器。 Only validated colors and numbers are emitted into fixed selectors. */
export function appearanceCss(settings: AppearanceSettings): string {
  const navigation = regionAppearance(settings, 'navigation');
  const controls = regionAppearance(settings, 'member-controls');
  const dice = regionAppearance(settings, 'dice');
  return [
    `:root{${declarations(settings.global)};--appearance-navigation-height:${72 * Math.max(1, navigation.fontScale / 100, navigation.buttonScale / 100)}px}`,
    ...APPEARANCE_REGIONS.map(region => `[data-appearance-region="${region.id}"]{${declarations(regionAppearance(settings, region.id))}}`),
    ...APPEARANCE_REGIONS.filter(region => regionAppearance(settings, region.id).colors.background !== DEFAULT_APPEARANCE_VALUES.colors.background).map(region => `[data-appearance-region="${region.id}"]:not([data-appearance-surface]){background-color:color-mix(in srgb,var(--background) var(--appearance-surface-opacity),transparent);border-radius:var(--appearance-radius-lg)}`),
    controls.surfaceOpacity !== 100 || controls.blur !== 0 || controls.colors.surface !== DEFAULT_APPEARANCE_VALUES.colors.surface ? '[data-appearance-region="member-controls"]{background-color:color-mix(in srgb,var(--card) var(--appearance-surface-opacity),transparent);border-radius:var(--appearance-radius-lg);backdrop-filter:var(--appearance-backdrop-filter)}' : '',
    `[data-appearance-editor]{${declarations(DEFAULT_APPEARANCE_VALUES)}}`,
    controls.fontScale > 125 || controls.buttonScale > 115 ? '@media(max-width:639px){[data-appearance-region="member-controls"] [data-appearance-actions]{grid-template-columns:repeat(2,minmax(0,1fr))}[data-appearance-region="member-controls"] #drink-button{grid-column:1/-1}}' : '',
    dice.fontScale > 125 || dice.buttonScale > 115 ? '@media(max-width:639px){#dice-count-toggle span{display:none}}' : '',
  ].join('\n');
}
