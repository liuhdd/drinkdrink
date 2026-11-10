'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Minus, Plus, RotateCcw, Wine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { appearanceVariables } from '@/client/appearance-css';
import { APPEARANCE_REGIONS, DEFAULT_APPEARANCE_VALUES, regionAppearance } from '@/shared/appearance';
import type { AppearanceColors, AppearanceRegionId, AppearanceSettings as Settings, AppearanceValues } from '@/shared/appearance';

const pages = [
  { id: 'global', label: '全站统一' }, { id: 'shared', label: '公共区域' }, { id: 'ledger', label: '记账' },
  { id: 'ranking', label: '排行' }, { id: 'history', label: '历史' }, { id: 'tools', label: '工具' }, { id: 'settings', label: '设置与弹窗' },
] as const;
type PageId = typeof pages[number]['id'];
type NumericKey = 'fontScale' | 'radiusScale' | 'surfaceOpacity' | 'blur' | 'buttonScale';
const dimensions: readonly { key: NumericKey; id: string; label: string; min: number; max: number; unit: string }[] = [
  { key: 'fontScale', id: 'font-scale', label: '字体大小', min: 75, max: 150, unit: '%' },
  { key: 'radiusScale', id: 'radius-scale', label: '圆角程度', min: 0, max: 200, unit: '%' },
  { key: 'surfaceOpacity', id: 'opacity', label: '区域不透明度', min: 0, max: 100, unit: '%' },
  { key: 'blur', id: 'blur', label: '毛玻璃模糊', min: 0, max: 24, unit: 'px' },
  { key: 'buttonScale', id: 'button-scale', label: '按钮大小', min: 80, max: 130, unit: '%' },
];
const colorFields: readonly { key: keyof AppearanceColors; label: string }[] = [
  { key: 'background', label: '页面背景' }, { key: 'surface', label: '区域底色' }, { key: 'text', label: '文字' }, { key: 'muted', label: '次要文字' },
  { key: 'accent', label: '强调色' }, { key: 'secondary', label: '选中底色' }, { key: 'border', label: '区域边框' }, { key: 'input', label: '输入框边框' },
];
const presets: readonly { id: string; label: string; colors: AppearanceColors }[] = [
  { id: 'cream', label: '奶油橙', colors: DEFAULT_APPEARANCE_VALUES.colors },
  { id: 'ios', label: 'iOS 极简', colors: { background: '#f2f2f7', surface: '#ffffff', text: '#1c1c1e', muted: '#636366', accent: '#1c1c1e', secondary: '#e5e5ea', border: '#e5e5ea', input: '#c7c7cc' } },
  { id: 'blue', label: '雾蓝', colors: { background: '#f3f7fc', surface: '#ffffff', text: '#20334c', muted: '#586b82', accent: '#285ea6', secondary: '#e0ecfa', border: '#dce5f0', input: '#b7c9df' } },
  { id: 'mint', label: '薄荷', colors: { background: '#f2f8f4', surface: '#ffffff', text: '#233b31', muted: '#536f60', accent: '#24734e', secondary: '#dcefe3', border: '#d7e7dc', input: '#b7d1c0' } },
  { id: 'dark', label: '夜色', colors: { background: '#1c2028', surface: '#292f3b', text: '#f2f4f8', muted: '#b0bac9', accent: '#ffad70', secondary: '#46372f', border: '#414b5c', input: '#59677c' } },
];
const selectClass = 'h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

function DimensionControl({ id, label, value, min, max, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const validate = (text: string): number => {
    const numeric = Number(text);
    if (!text.trim() || !Number.isInteger(numeric) || numeric < min || numeric > max) throw new RangeError(`${label}需填写 ${min} 到 ${max} 之间的整数`);
    return numeric;
  };
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label><div className="flex min-w-0 items-center gap-3">
    <input id={id} type="range" min={min} max={max} step={1} value={value} aria-valuetext={`${value}${unit}`} className="h-8 min-w-0 flex-1 accent-primary" onChange={event => { setDraft(null); setError(''); onChange(Number(event.currentTarget.value)); }} />
    <div className="flex w-24 shrink-0 items-center gap-1"><Input id={`${id}-number`} type="number" inputMode="numeric" min={min} max={max} step={1} value={draft ?? String(value)} aria-label={`${label}数值`} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className="h-9 px-2 text-right text-sm tabular-nums" onChange={event => { const text = event.currentTarget.value; setDraft(text); setError(''); if (text.trim() && Number.isInteger(Number(text)) && Number(text) >= min && Number(text) <= max) onChange(Number(text)); }} onBlur={() => { if (draft !== null) { try { validate(draft); setDraft(null); setError(''); } catch (caught) { if (!(caught instanceof RangeError)) throw caught; setError(caught.message); } } }} /><span className="w-6 shrink-0 text-xs text-muted-foreground">{unit}</span></div>
  </div>{error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}</div>;
}

function ColorControl({ name, label, value, onChange }: { name: keyof AppearanceColors; label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const id = `appearance-color-${name}`;
  return <div className="grid min-w-0 gap-2"><Label htmlFor={id}>{label}</Label><div className="flex min-w-0 items-center gap-2">
    <input id={id} type="color" value={value} className="h-11 w-11 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1" onChange={event => { setDraft(null); setError(''); onChange(event.currentTarget.value); }} />
    <Input id={`${id}-hex`} type="text" value={draft ?? value} spellCheck={false} maxLength={7} aria-label={`${label}十六进制颜色`} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className="min-w-0 font-mono text-sm" onChange={event => { const text = event.currentTarget.value; setDraft(text); setError(''); if (/^#[0-9a-f]{6}$/i.test(text)) onChange(text.toLowerCase()); }} onBlur={() => { if (draft !== null) { if (/^#[0-9a-f]{6}$/i.test(draft)) { setDraft(null); setError(''); } else setError(`${label}需填写 # 加 6 位十六进制颜色`); } }} />
  </div>{error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}</div>;
}

function AppearancePreview({ values }: { values: AppearanceValues }) {
  const [pending, setPending] = useState(4);
  return <section className="min-w-0 lg:sticky lg:top-5" aria-labelledby="appearance-preview-title"><h2 id="appearance-preview-title" className="mb-3 text-base font-semibold">实时预览</h2>
    <div className="relative isolate overflow-hidden rounded-lg p-4 sm:p-6" style={{ backgroundColor: values.colors.background }}><img src="/design/tools/dice.png" alt="" aria-hidden="true" width={180} height={180} className="absolute -top-2 -right-6 size-44 object-contain opacity-60" />
      <div id="appearance-preview" data-appearance-preview data-appearance-surface="card" className="relative rounded-lg border border-border p-4 text-foreground shadow-[var(--shadow-card)]" style={appearanceVariables(values)}>
        <div className="flex min-w-0 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><img src="/design/avatars/avatar-1.webp" alt="" width={44} height={44} className="size-11 shrink-0 rounded-full" /><strong className="truncate text-base">小林</strong></div><span className="flex shrink-0 flex-col items-end"><strong className="text-2xl font-semibold tabular-nums text-primary">{pending}</strong><span className="text-xs text-muted-foreground">待喝</span></span></div>
        <div className="mt-4 flex flex-wrap items-center gap-2"><Button id="appearance-preview-subtract" type="button" variant="outline" aria-label="预览减一" disabled={pending === 0} onClick={() => setPending(value => value - 1)}><Minus aria-hidden="true" />1</Button><Button id="appearance-preview-add" type="button" variant="outline" aria-label="预览加一" onClick={() => setPending(value => value + 1)}><Plus aria-hidden="true" />1</Button><Button id="appearance-preview-drink" type="button" disabled={pending < 2} onClick={() => setPending(value => value - 2)}><Wine aria-hidden="true" />喝完一杯</Button></div>
      </div>
    </div>
  </section>;
}

export function AppearanceSettings({ settings, error, onChange, onResetAll, onBack }: { settings: Settings; error: string; onChange: (next: Settings) => void; onResetAll: () => void; onBack: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  const [page, setPage] = useState<PageId>('global');
  const [region, setRegion] = useState<AppearanceRegionId>('members');
  const [revision, setRevision] = useState(0);
  useEffect(() => { title.current?.focus(); }, []);
  const global = page === 'global';
  const choices = APPEARANCE_REGIONS.filter(item => item.page === page);
  const values = global ? settings.global : regionAppearance(settings, region);
  const customized = !global && settings.regions[region] !== undefined;
  const changeValues = (next: AppearanceValues) => {
    if (global) onChange({ ...settings, global: next });
    else onChange({ ...settings, regions: { ...settings.regions, [region]: next } });
  };
  const restoreRegion = () => {
    if (global) onChange({ ...settings, global: DEFAULT_APPEARANCE_VALUES });
    else { const { [region]: removed, ...regions } = settings.regions; void removed; onChange({ ...settings, regions }); }
    setRevision(value => value + 1);
  };
  return <section id="appearance-settings" data-appearance-editor className="mx-auto max-w-5xl bg-background pb-6">
    <header className="mb-5 flex min-w-0 items-center gap-2"><Button id="appearance-back" type="button" variant="ghost" size="icon" aria-label="返回设置" onClick={onBack}><ArrowLeft aria-hidden="true" /></Button><h1 id="appearance-title" ref={title} tabIndex={-1} className="text-xl font-bold outline-none">外观设置</h1></header>
    {error && <div className="mb-5 rounded-lg border border-destructive/40 bg-card p-4"><p id="appearance-error" role="alert" className="break-words text-sm text-destructive">{error}</p><Button id="appearance-error-reset" type="button" variant="outline" className="mt-3" onClick={() => { onResetAll(); setRevision(value => value + 1); }}>恢复默认外观</Button></div>}
    <div className="mb-5 grid min-w-0 gap-3 rounded-lg bg-card p-4 sm:grid-cols-2"><div className="grid min-w-0 gap-2"><Label htmlFor="appearance-page">页面</Label><select id="appearance-page" className={selectClass} value={page} onChange={event => { const selected = pages.find(item => item.id === event.currentTarget.value); if (!selected) throw new RangeError('请选择已有的外观页面'); setPage(selected.id); if (selected.id !== 'global') { const first = APPEARANCE_REGIONS.find(item => item.page === selected.id); if (!first) throw new RangeError('所选页面没有可调整区域'); setRegion(first.id); } setRevision(value => value + 1); }}>{pages.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
      <div className="grid min-w-0 gap-2"><Label htmlFor="appearance-region">区域</Label><select id="appearance-region" className={selectClass} disabled={global} value={global ? 'global' : region} onChange={event => { const selected = choices.find(item => item.id === event.currentTarget.value); if (!selected) throw new RangeError('请选择当前页面的已有区域'); setRegion(selected.id); setRevision(value => value + 1); }}>{global ? <option value="global">所有页面与区域</option> : choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
      {!global && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input id="appearance-customize-region" type="checkbox" checked={customized} className="size-4 accent-primary" onChange={event => { if (event.currentTarget.checked) onChange({ ...settings, regions: { ...settings.regions, [region]: values } }); else restoreRegion(); }} />单独设置此区域</label>}
    </div>
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"><div className="min-w-0 lg:order-2"><AppearancePreview values={values} /></div>
      <fieldset disabled={!global && !customized} className="grid min-w-0 gap-5 disabled:opacity-60 lg:order-1"><section className="grid gap-5 rounded-lg bg-card p-4 sm:p-5" aria-labelledby="appearance-dimensions-title"><h2 id="appearance-dimensions-title" className="text-base font-semibold">尺寸与质感</h2>{dimensions.map(field => <DimensionControl key={`${page}-${region}-${revision}-${field.key}`} id={`appearance-${field.id}`} label={field.label} value={values[field.key]} min={field.min} max={field.max} unit={field.unit} onChange={value => changeValues({ ...values, [field.key]: value })} />)}{values.blur > 0 && values.surfaceOpacity === 100 && <p className="text-xs leading-5 text-muted-foreground">降低区域不透明度，可以看见毛玻璃效果。</p>}</section>
        <section className="grid gap-4 rounded-lg bg-card p-4 sm:p-5" aria-labelledby="appearance-colors-title"><h2 id="appearance-colors-title" className="text-base font-semibold">配色</h2><div className="grid grid-cols-2 gap-2">{presets.map(preset => <Button id={`appearance-preset-${preset.id}`} key={preset.id} type="button" variant="outline" aria-pressed={colorFields.every(field => values.colors[field.key] === preset.colors[field.key])} className="h-auto min-h-11 min-w-0 gap-2 px-2 text-sm aria-pressed:border-primary" onClick={() => { changeValues({ ...values, colors: { ...preset.colors } }); setRevision(value => value + 1); }}><span aria-hidden="true" className="flex shrink-0 -space-x-1">{[preset.colors.background, preset.colors.surface, preset.colors.accent].map((color, index) => <span key={index} className="size-3.5 rounded-full border border-input" style={{ backgroundColor: color }} />)}</span>{preset.label}</Button>)}</div><div className="grid min-w-0 gap-4 sm:grid-cols-2">{colorFields.map(field => <ColorControl key={`${page}-${region}-${revision}-${field.key}`} name={field.key} label={field.label} value={values.colors[field.key]} onChange={value => changeValues({ ...values, colors: { ...values.colors, [field.key]: value } })} />)}</div></section>
      </fieldset>
    </div>
    <footer className="mt-5 flex flex-wrap gap-2"><Button id="appearance-reset-region" type="button" variant="outline" onClick={restoreRegion}><RotateCcw aria-hidden="true" />{global ? '恢复全站默认' : '区域跟随全站'}</Button><Button id="appearance-reset-all" type="button" variant="ghost" onClick={() => { onResetAll(); setRevision(value => value + 1); }}>恢复全部默认</Button></footer>
  </section>;
}
