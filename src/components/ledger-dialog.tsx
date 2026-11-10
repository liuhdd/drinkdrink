'use client';

import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle2, ChevronRight, History, ImageDown, Palette, Pencil, Plus, Settings, Trash2, UserRoundPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddMembersForm, EditMemberForm, EndSessionForm, NewSessionForm, RemoveMemberForm, SettingsForm } from './ledger-forms';
import { SummaryPreview } from './summary-preview';
import { Activities, dateTime, Ranking } from './ledger-panels';
import type { Archive, Ledger, Member, Session } from '@/shared/types';
import type { LedgerController } from '@/hooks/use-ledger';
import { domainError } from '@/shared/errors';

export type LedgerDialogState = { kind: 'menu' | 'add' | 'settings' | 'new' | 'end' } | { kind: 'edit' | 'remove'; member: Member } | { kind: 'history'; archive: Archive } | { kind: 'summary'; session: Session; endedAt: number };
const titles = { menu: '设置', add: '添加酒友', edit: '编辑酒友', remove: '移除成员', settings: '对局设置', new: '开启新一局', end: '结束本局', history: '历史酒局', summary: '总结分享图' };
const icons = { menu: Settings, add: UserRoundPlus, edit: Pencil, remove: Trash2, settings: Settings, new: Plus, end: CheckCircle2, history: History, summary: ImageDown };
export function LedgerDialog({ state, ledger, controller, close, show, restoreFocus, appearance }: { state: LedgerDialogState | null; ledger: Ledger | undefined; controller: LedgerController; close: () => void; show: (state: LedgerDialogState) => void; restoreFocus: () => void; appearance: () => void }) {
  // 关闭时卸载弹窗，避免退出动画保留空内容并拦截下一次点击。 Unmount on close so exiting empty content cannot intercept the next click.
  if (state === null) return null;
  if (state.kind !== 'menu' && !ledger) throw domainError('酒局记录尚未加载，无法打开对局操作', 'open ledger dialog');
  const Icon = icons[state.kind];
  const props = ledger ? { ledger, controller, close } : null;
  const summary = (session: Session, endedAt: number) => show({ kind: 'summary', session: structuredClone(session), endedAt });
  const region = state.kind === 'menu' ? 'settings-menu' : state.kind === 'settings' ? 'session-settings' : state.kind === 'new' ? 'new-session' : state.kind === 'history' ? 'history-details' : state.kind === 'summary' ? 'summary' : 'member-dialog';
  return <Dialog open={state !== null} onOpenChange={open => { if (!open && !controller.saving) close(); }}><DialogContent id={state ? `${state.kind}-dialog` : undefined} data-appearance-region={region} data-appearance-surface="card" className="max-h-[85dvh] overflow-y-auto rounded-lg bg-card sm:max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (controller.saving) event.preventDefault(); }} onPointerDownOutside={event => { if (controller.saving) event.preventDefault(); }}>
    <DialogHeader className="mb-1 border-b pb-4 text-left"><DialogTitle className="flex items-center gap-2.5 pr-8 leading-6">{state.kind === 'settings' ? <Button id="settings-back" type="button" variant="ghost" size="icon-sm" aria-label="返回设置" onClick={() => show({ kind: 'menu' })}><ArrowLeft aria-hidden="true" /></Button> : <Icon aria-hidden="true" className="size-5 shrink-0 text-primary" />}<span className="min-w-0 break-words">{state?.kind === 'history' ? state.archive.session.title : state ? titles[state.kind] : ''}</span></DialogTitle><DialogDescription className="sr-only">管理对局、成员与界面外观</DialogDescription></DialogHeader>
    {state.kind === 'menu' && <div id="settings-menu" className="grid gap-3"><Button id="settings-session" type="button" variant="outline" className="h-auto justify-start gap-3 whitespace-normal px-4 py-4 text-left" disabled={!ledger || controller.loading || controller.saving} onClick={() => show({ kind: 'settings' })}><Settings aria-hidden="true" className="size-5 text-primary" /><span className="flex-1">对局设置</span><ChevronRight aria-hidden="true" /></Button><Button id="settings-appearance" type="button" variant="outline" className="h-auto justify-start gap-3 whitespace-normal px-4 py-4 text-left" onClick={appearance}><Palette aria-hidden="true" className="size-5 text-primary" /><span className="flex-1">外观设置</span><ChevronRight aria-hidden="true" /></Button></div>}
    {props && state?.kind === 'add' && <AddMembersForm {...props} />}
    {props && state?.kind === 'edit' && <EditMemberForm {...props} member={state.member} remove={() => show({ kind: 'remove', member: state.member })} />}
    {props && state?.kind === 'remove' && <RemoveMemberForm {...props} member={state.member} />}
    {props && state?.kind === 'settings' && <SettingsForm {...props} start={() => show({ kind: 'new' })} end={() => show({ kind: 'end' })} />}
    {props && state?.kind === 'new' && <NewSessionForm {...props} />}
    {props && state?.kind === 'end' && <EndSessionForm {...props} summary={summary} />}
    {state?.kind === 'summary' && <SummaryPreview session={state.session} endedAt={state.endedAt} />}
    {state?.kind === 'history' && <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5"><p className="text-xs leading-6 text-muted-foreground">{dateTime(state.archive.session.startedAt)} 至 {dateTime(state.archive.endedAt)}</p><h3 className="font-medium">本局排行</h3><Ranking session={state.archive.session} /><h3 className="font-medium">操作记录</h3><Activities events={state.archive.session.events} /><Button id="history-summary-button" type="button" onClick={() => summary(state.archive.session, state.archive.endedAt)}>总结分享图</Button></div>}
  </DialogContent></Dialog>;
}
