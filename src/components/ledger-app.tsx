'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Beer, ChevronRight, Dices, History, ImageDown, LayoutGrid, Loader2, Minus, MoreHorizontal, Pencil, Plus, Settings, Trophy, UserRoundPlus, Undo2, Wine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLedger } from '@/hooks/use-ledger';
import { useWebMcp } from '@/hooks/use-webmcp';
import { LedgerDialog, type LedgerDialogState } from './ledger-dialog';
import { DrinkingTools } from './drinking-tools';
import { Activities, Avatar, dateTime, Members, RankingPanel } from './ledger-panels';
import { MAX_COUNT } from '@/shared/domain';
import { recordAction } from '@/client/actions';
import { withLedgerSession } from '@/shared/persistence';
import { domainError } from '@/shared/errors';
import type { Member } from '@/shared/types';

export function LedgerApp() {
  const opener = useRef<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<LedgerDialogState | null>(null);
  const [view, setView] = useState('ledger');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [toast, setToast] = useState('');
  const controller = useLedger(dialog !== null);
  const ledger = controller.current?.ledger;
  const session = ledger?.session;
  const finished = session?.endedAt !== undefined;
  const member = session?.members.find(item => item.id === selectedId);
  useEffect(() => {
    if (!controller.notice) return;
    setToast(controller.notice);
    const timer = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(timer);
  }, [controller.notice, controller.current]);
  const close = () => { if (!controller.saving) setDialog(null); };
  const show = (state: LedgerDialogState) => {
    if (dialog === null) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActionError('');
    setDialog(state);
  };
  const restoreFocus = () => {
    // 开局、结束或移除会删除入口；此时焦点转到始终存在的设置入口。 When a transition removes the opener, focus the persistent settings entry.
    const target = opener.current?.isConnected ? opener.current : document.getElementById(window.matchMedia('(min-width: 1024px)').matches ? 'desktop-settings' : 'settings-button');
    if (!target) throw domainError('无法恢复焦点：酒局设置入口不存在', 'restore dialog focus');
    target.focus();
  };
  const run = async (operation: () => Promise<void>) => {
    setActionError('');
    try { await operation(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const record = useCallback(async (id: string, action: string, quantity: number): Promise<Member> => {
    if (!ledger) throw domainError('记录尚未加载', 'record action');
    const next = recordAction(ledger.session, id, action, quantity, { id: crypto.randomUUID(), at: Date.now() });
    const saved = await controller.saveMember(withLedgerSession(ledger, next, {}), '已完成记账');
    setSelectedId(id);
    const savedMember = saved.ledger.session.members.find(item => item.id === id);
    if (!savedMember) throw domainError('没有找到这位成员', 'record action');
    return savedMember;
  }, [ledger, controller.saveMember]);
  useWebMcp(ledger ?? null, record, setActionError);
  const nav = [ { value: 'ledger', label: '记账', desktopLabel: '酒局记账', icon: LayoutGrid }, { value: 'ranking', label: '排行', desktopLabel: '单局排行', icon: Trophy }, { value: 'history', label: '历史', desktopLabel: '历史酒局', icon: History }, { value: 'tools', label: '工具', desktopLabel: '喝酒工具', icon: Dices } ];
  const error = actionError || controller.error;
  return <Tabs orientation="horizontal" value={view} onValueChange={setView} className="min-h-dvh gap-0 pb-24 lg:pb-0">
    <nav id="app-header" aria-label="应用导航"><div id="session-header" className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2.5"><span aria-hidden="true" className="relative block h-9 w-11 shrink-0"><Beer className="absolute top-1 left-0 size-7 -rotate-12 fill-secondary stroke-foreground" /><Beer className="absolute top-1 right-0 size-7 rotate-12 fill-secondary stroke-foreground" /></span>{view === 'tools' ? <span className="truncate text-lg font-bold sm:text-xl">微醺账本</span> : <h1 id="session-title" title={session?.title} className="min-w-0 truncate text-lg font-bold leading-7 sm:text-xl">{session?.title ?? '微醺账本'}</h1>}{view !== 'tools' && session?.demo && <span id="demo-badge" className="shrink-0 rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] leading-4 font-medium text-primary">体验酒局</span>}</div>
      <div className="flex shrink-0 items-center gap-4">
      <TabsList variant="line" className="hidden lg:flex">{nav.map(item => <TabsTrigger id={`nav-${item.value}`} key={item.value} value={item.value} className="gap-2 px-1 pb-1 text-[13px]"><item.icon aria-hidden="true" className="size-4" />{item.desktopLabel}</TabsTrigger>)}</TabsList>
      <Button id="desktop-settings" type="button" variant="ghost" size="icon" disabled={!ledger || controller.loading || controller.saving} onClick={() => show({ kind: 'settings' })} aria-label="酒局设置"><MoreHorizontal aria-hidden="true" className="size-5" /></Button>
      </div>
    </div></nav>
    <main className="mx-auto w-full max-w-6xl px-4 pt-2 sm:px-8 sm:pt-5">
      {view !== 'tools' && error && <p id="integration-error" role="alert" className="mb-5 break-words border border-destructive/40 bg-destructive/10 p-4 text-sm leading-6 text-destructive">{error}</p>}
      <TabsContent value="tools" id="tools-view" className="m-0"><DrinkingTools /></TabsContent>
      {view !== 'tools' && (controller.loading || !ledger || !session ? <section id="load-notice" className="rounded-lg border bg-card p-10 text-center" role="status">{controller.loading && <Loader2 className="mx-auto mb-4 size-6 animate-spin text-primary" />}<p id="load-message" className="text-sm text-muted-foreground">{controller.loading ? '正在加载已保存的酒局…' : '记录未加载，请检查错误信息后重试。'}</p>{!controller.loading && <Button id="retry-storage" type="button" className="mt-5" onClick={() => void controller.initialize()}>重新加载</Button>}</section> : <>
        {finished && <section id="finished-session" className="mb-6 flex flex-wrap items-center justify-between gap-4 border border-primary/30 bg-primary/[0.04] p-5"><div><strong className="text-primary">本局已结束</strong></div><div className="flex flex-wrap gap-2"><Button id="current-summary-button" type="button" variant="outline" onClick={() => show({ kind: 'summary', session: structuredClone(session), endedAt: session.endedAt! })}><ImageDown aria-hidden="true" />总结分享图</Button><Button id="finished-new-session" type="button" onClick={() => show({ kind: 'new' })}><Plus aria-hidden="true" />新开一局</Button></div></section>}
        <TabsContent value="ledger" id="ledger-view" className="m-0"><div id="workspace" className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Card id="ledger-panel" role="region" aria-label="成员记账" className="bg-transparent p-0 shadow-none sm:p-0"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 whitespace-nowrap text-lg font-bold"><span id="member-count" className="tabular-nums">{session.members.length}</span>位酒友</h2>{!finished && <Button id="add-members-button" type="button" variant="ghost" size="sm" className="text-primary" disabled={controller.saving} onClick={() => show({ kind: 'add' })}><UserRoundPlus aria-hidden="true" />添加酒友</Button>}</div>
            <Members session={session} selectedId={selectedId} select={setSelectedId} />
            {member && <section id="member-controls" className="mt-3 rounded-lg bg-secondary p-3 sm:p-4" aria-label="所选酒友的记酒操作"><div className="flex items-center gap-3"><Avatar profile={member} /><div className="min-w-0 flex-1"><h3 className="break-all text-base font-semibold">{member.name}</h3>{finished && <span className="mt-0.5 block text-xs text-muted-foreground">已结束</span>}</div>{!finished && <Button id="edit-member-button" type="button" variant="ghost" size="icon" aria-label={`编辑${member.name}`} disabled={controller.saving} onClick={() => show({ kind: 'edit', member })}><Pencil aria-hidden="true" /></Button>}</div>
              {finished ? <p className="mt-3 text-xs text-muted-foreground">已喝 {member.consumed} 个 · {member.cups} 杯 · 剩余待喝 {member.pending} 个</p> : <div className="mt-3 grid grid-cols-[1fr_1fr_1.45fr] gap-2"><Button id="subtract-button" type="button" variant="outline" className="h-12 border-transparent bg-card/80 text-lg tabular-nums text-primary" disabled={controller.saving || member.pending < ledger.step} onClick={() => void run(async () => { await record(member.id, 'subtract', ledger.step); })} aria-label={`减少${ledger.step}个待喝`}><Minus aria-hidden="true" />{ledger.step}</Button><Button id="add-button" type="button" variant="outline" className="h-12 border-transparent bg-card/80 text-lg tabular-nums text-primary" disabled={controller.saving || member.pending + ledger.step > MAX_COUNT} onClick={() => void run(async () => { await record(member.id, 'add', ledger.step); })} aria-label={`增加${ledger.step}个待喝`}><Plus aria-hidden="true" />{ledger.step}</Button><Button id="drink-button" type="button" className="h-12 gap-1 px-2 text-xs min-[375px]:text-sm" title={`喝完一杯，扣减 ${session.cupSize} 个`} aria-label={`${member.name}喝完一杯，扣减${session.cupSize}个`} disabled={controller.saving || member.pending < session.cupSize || member.consumed + session.cupSize > MAX_COUNT} onClick={() => void run(async () => { await record(member.id, 'drink', ledger.step); })}><Wine aria-hidden="true" />喝完一杯</Button></div>}
            </section>}
            <section className="mt-4"><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-base font-bold">最近记录</h3><Button id="undo-button" type="button" variant="ghost" size="sm" className="text-primary" disabled={finished || !controller.canUndo || controller.saving} onClick={() => void run(controller.undo)}><Undo2 aria-hidden="true" />撤销上一步</Button></div><Activities events={session.events.slice(0, 5)} /></section>
          </Card><div className="hidden lg:block"><RankingPanel session={session} /></div>
        </div></TabsContent>
        <TabsContent value="ranking" id="ranking-view" className="mx-auto mt-0 max-w-2xl"><RankingPanel session={session} /></TabsContent>
        <TabsContent value="history" id="history-view" className="m-0"><Card id="history-panel" role="region" aria-label="历史酒局"><h2 className="mb-3 flex items-center gap-2.5 text-lg font-semibold"><History aria-hidden="true" className="size-4 text-primary" />历史酒局<span className="ml-1 font-mono text-xs font-normal tabular-nums text-muted-foreground">[{ledger.history.length}]</span></h2><div id="history-list" className="divide-y divide-border/70">{ledger.history.length ? ledger.history.map(archive => <button type="button" key={archive.id} data-testid={`history-${archive.id}`} className="flex w-full items-center justify-between gap-3 py-5 text-left transition-colors hover:bg-accent/30" onClick={() => show({ kind: 'history', archive })}><span className="min-w-0"><strong className="block truncate font-medium">{archive.session.title}</strong><span className="mt-2 block font-mono text-[11px] tabular-nums text-muted-foreground">{dateTime(archive.session.startedAt)}</span><span className="mt-1.5 block text-xs text-muted-foreground">{archive.session.members.length} 位酒友 · 已喝 {archive.session.members.reduce((sum, item) => sum + item.consumed, 0)} 个</span></span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /></button>) : <p className="py-12 text-center text-sm text-muted-foreground">还没有历史酒局</p>}</div></Card></TabsContent>
      </>)}
      {ledger && <LedgerDialog state={dialog} ledger={ledger} controller={controller} close={close} show={show} restoreFocus={restoreFocus} />}
      {view !== 'tools' && controller.saving && <span role="status" className="sr-only">正在保存…</span>}
      {view !== 'tools' && controller.localError && <div className="my-5 text-[11px]"><p role="alert" className="break-words text-destructive">{controller.localError.message}</p><Button id="retry-local-storage" type="button" variant="link" disabled={controller.saving} onClick={() => void run(controller.repair)}>重试本地维护</Button></div>}
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-30 rounded-t-lg bg-card px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_24px_-12px_rgba(87,47,17,0.2)] lg:hidden" aria-label="移动导航"><TabsList className="grid w-full grid-cols-5 gap-0.5 rounded-none bg-transparent py-2 group-data-[orientation=horizontal]/tabs:h-[72px]">{nav.map(item => <TabsTrigger id={`mobile-${item.value}`} key={item.value} value={item.value} className="flex-col gap-1 rounded-md text-[11px] data-[state=active]:bg-transparent data-[state=active]:text-primary"><item.icon aria-hidden="true" className="size-5" />{item.label}<span aria-hidden="true" className={`size-1 rounded-full ${view === item.value ? 'bg-primary' : 'bg-transparent'}`} /></TabsTrigger>)}<Button id="settings-button" aria-label="酒局设置" type="button" variant="ghost" className="h-full flex-col gap-1 rounded-md pb-2 text-[11px] font-normal text-muted-foreground" disabled={!ledger || controller.saving} onClick={() => show({ kind: 'settings' })}><Settings aria-hidden="true" className="size-5" />设置</Button></TabsList></nav>
    {toast && <div id="toast" role="status" aria-live="polite" className="fixed bottom-24 left-1/2 z-40 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md bg-foreground px-5 py-3 text-sm text-background lg:bottom-6">{toast}</div>}
  </Tabs>;
}
