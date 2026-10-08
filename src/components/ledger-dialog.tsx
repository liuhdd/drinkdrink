'use client';

import { Button } from '@/components/ui/button';
import { CheckCircle2, History, ImageDown, Pencil, Plus, Settings, Trash2, UserRoundPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddMembersForm, EditMemberForm, EndSessionForm, NewSessionForm, RemoveMemberForm, SettingsForm } from './ledger-forms';
import { SummaryPreview } from './summary-preview';
import { Activities, dateTime, Ranking } from './ledger-panels';
import type { Archive, Ledger, Member, Session } from '@/shared/types';
import type { LedgerController } from '@/hooks/use-ledger';

export type LedgerDialogState = { kind: 'add' | 'settings' | 'new' | 'end' } | { kind: 'edit' | 'remove'; member: Member } | { kind: 'history'; archive: Archive } | { kind: 'summary'; session: Session; endedAt: number };
const titles = { add: '添加酒友', edit: '编辑酒友', remove: '移除成员', settings: '酒局设置', new: '开启新一局', end: '结束本局', history: '历史酒局', summary: '总结分享图' };
const icons = { add: UserRoundPlus, edit: Pencil, remove: Trash2, settings: Settings, new: Plus, end: CheckCircle2, history: History, summary: ImageDown };
export function LedgerDialog({ state, ledger, controller, close, show, restoreFocus }: { state: LedgerDialogState | null; ledger: Ledger; controller: LedgerController; close: () => void; show: (state: LedgerDialogState) => void; restoreFocus: () => void }) {
  // 关闭时卸载弹窗，避免退出动画保留空内容并拦截下一次点击。 Unmount on close so exiting empty content cannot intercept the next click.
  if (state === null) return null;
  const Icon = icons[state.kind];
  const props = { ledger, controller, close };
  const summary = (session: Session, endedAt: number) => show({ kind: 'summary', session: structuredClone(session), endedAt });
  return <Dialog open={state !== null} onOpenChange={open => { if (!open && !controller.saving) close(); }}><DialogContent id={state ? `${state.kind}-dialog` : undefined} className="max-h-[85dvh] overflow-y-auto rounded-2xl bg-card sm:max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (controller.saving) event.preventDefault(); }} onPointerDownOutside={event => { if (controller.saving) event.preventDefault(); }}>
    <DialogHeader className="mb-1 border-b pb-5 text-left"><DialogTitle className="flex items-center gap-3 pr-8 leading-6"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><Icon aria-hidden="true" className="size-5" /></span><span className="min-w-0 break-words">{state?.kind === 'history' ? state.archive.session.title : state ? titles[state.kind] : ''}</span></DialogTitle><DialogDescription className="sr-only">管理酒局成员、计数、设置与总结</DialogDescription></DialogHeader>
    {state?.kind === 'add' && <AddMembersForm {...props} />}
    {state?.kind === 'edit' && <EditMemberForm {...props} member={state.member} remove={() => show({ kind: 'remove', member: state.member })} />}
    {state?.kind === 'remove' && <RemoveMemberForm {...props} member={state.member} />}
    {state?.kind === 'settings' && <SettingsForm {...props} start={() => show({ kind: 'new' })} />}
    {state?.kind === 'new' && <NewSessionForm {...props} />}
    {state?.kind === 'end' && <EndSessionForm {...props} summary={summary} />}
    {state?.kind === 'summary' && <SummaryPreview session={state.session} endedAt={state.endedAt} />}
    {state?.kind === 'history' && <div className="grid gap-5"><p className="text-xs leading-6 text-muted-foreground">{dateTime(state.archive.session.startedAt)} — {dateTime(state.archive.endedAt)} · 第 {state.archive.session.round} 局 · 1 杯 = {state.archive.session.cupSize} 个</p><h3 className="font-medium">本局排行</h3><Ranking session={state.archive.session} /><h3 className="font-medium">操作记录</h3><Activities events={state.archive.session.events} /><Button id="history-summary-button" type="button" onClick={() => summary(state.archive.session, state.archive.endedAt)}>总结分享图</Button></div>}
  </DialogContent></Dialog>;
}
