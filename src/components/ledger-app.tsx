'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronRight, CloudCheck, Martini, History, ImageDown, LayoutGrid, Loader2, Minus, Pencil, Plus, Settings, ShieldCheck, Trophy, UserRoundPlus, Users, Undo2, Wine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLedger } from '@/hooks/use-ledger';
import { useWebMcp } from '@/hooks/use-webmcp';
import { LedgerDialog, type LedgerDialogState } from './ledger-dialog';
import { Activities, dateTime, Members, RankingPanel } from './ledger-panels';
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
    const target = opener.current?.isConnected ? opener.current : document.getElementById('settings-button');
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
  const nav = [ { value: 'ledger', label: '记账', icon: LayoutGrid }, { value: 'ranking', label: '排行', icon: Trophy }, { value: 'history', label: '历史', icon: History } ];
  const error = actionError || controller.error;
  return <Tabs orientation="horizontal" value={view} onValueChange={setView} className="min-h-dvh gap-0 pb-24 md:pb-0">
    <header className="border-b border-border/70 bg-card/80 backdrop-blur-xl"><div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
      <button id="brand-home" type="button" className="flex items-center gap-3 rounded-xl text-left" onClick={() => { setView('ledger'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label="微醺账本首页"><span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_4px_12px_#7754d624]"><Wine aria-hidden="true" className="size-6" /></span><span className="text-lg font-semibold tracking-wider">微醺账本<span className="mt-1 block text-[9px] font-normal tracking-[.18em] text-muted-foreground">CHEERS, KEEP TRACK.</span></span></button>
      <TabsList className="hidden rounded-full bg-muted/80 p-1 group-data-[orientation=horizontal]/tabs:h-11 md:flex">{nav.map(item => <TabsTrigger id={`nav-${item.value}`} key={item.value} value={item.value} className="gap-2 rounded-full px-5 data-[state=active]:bg-card data-[state=active]:text-primary"><item.icon aria-hidden="true" className="size-4" />{item.label === '记账' ? '酒局记账' : item.label === '排行' ? '单局排行' : '历史酒局'}</TabsTrigger>)}</TabsList>
      <Button id="settings-button" type="button" variant="ghost" disabled={!ledger || controller.loading || controller.saving} onClick={() => show({ kind: 'settings' })} aria-label="酒局设置"><Settings aria-hidden="true" /><span className="hidden sm:inline">酒局设置</span></Button>
    </div></header>
    <main className="mx-auto w-full max-w-6xl px-5 pt-9 sm:px-8 sm:pt-12">
      {error && <p id="integration-error" role="alert" className="mb-5 break-words rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6 text-destructive">{error}</p>}
      <section className="relative mb-8 flex flex-wrap items-end justify-between gap-5 overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-card to-accent/40 p-6 sm:p-8"><Martini aria-hidden="true" className="pointer-events-none absolute right-12 top-1/2 hidden size-36 -translate-y-1/2 -rotate-12 text-primary/10 md:block" /><div className="relative"><p className="flex flex-wrap items-center gap-2 text-[10px] tracking-[.18em] text-muted-foreground"><span className="size-1.5 rounded-full bg-primary" />TONIGHT’S SESSION{session?.demo && <span id="demo-badge" className="rounded-full border border-primary/10 bg-accent px-2 py-1 tracking-normal text-primary">体验酒局</span>}</p><h1 className="mt-4 text-[26px] font-semibold tracking-tight min-[375px]:text-3xl sm:text-[40px]">今晚，喝个明白<span className="text-primary">。</span></h1>{session && <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground"><span id="session-title" className="max-w-full break-words font-medium text-foreground/80">{session.title}</span><span>·</span><span>第 {String(session.round).padStart(2, '0')} 局</span><span className="flex items-center gap-1.5"><CalendarDays aria-hidden="true" className="size-3.5" />{new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' }).format(session.startedAt)}</span></p>}</div>
        {session && !session.demo && !finished && <Button id="end-session-button" type="button" variant="outline" disabled={controller.saving} onClick={() => show({ kind: 'end' })}><CheckCircle2 aria-hidden="true" />结束本局</Button>}
      </section>
      {controller.loading || !ledger || !session ? <section id="load-notice" className="rounded-2xl border bg-card p-10 text-center" role="status">{controller.loading && <Loader2 className="mx-auto mb-4 size-6 animate-spin text-primary" />}<p id="load-message" className="text-sm text-muted-foreground">{controller.loading ? '正在加载已保存的酒局…' : '记录未加载，请检查错误信息后重试。'}</p>{!controller.loading && <Button id="retry-storage" type="button" className="mt-5" onClick={() => void controller.initialize()}>重新加载</Button>}</section> : <>
        {finished && <section id="finished-session" className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-accent/50 p-5"><div><strong className="text-primary">本局已结束</strong><p className="mt-1 text-xs leading-6 text-muted-foreground">{dateTime(session.endedAt!)} 结束 · 最终记录已保存</p></div><div className="flex flex-wrap gap-2"><Button id="current-summary-button" type="button" variant="outline" onClick={() => show({ kind: 'summary', session: structuredClone(session), endedAt: session.endedAt! })}><ImageDown aria-hidden="true" />总结分享图</Button><Button id="finished-new-session" type="button" onClick={() => show({ kind: 'new' })}><Plus aria-hidden="true" />新开一局</Button></div></section>}
        <TabsContent value="ledger" id="ledger-view" className="m-0"><div id="workspace" className="grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Card id="ledger-panel" role="region" aria-label="成员记账"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 whitespace-nowrap text-lg font-semibold"><span className="hidden size-9 items-center justify-center rounded-xl bg-accent text-primary min-[375px]:flex"><Users aria-hidden="true" className="size-4" /></span>本局酒友<span id="member-count" className="rounded-full bg-muted px-2 py-1 text-xs font-normal text-muted-foreground">{String(session.members.length).padStart(2, '0')}</span></h2>{!finished && <Button id="add-members-button" type="button" disabled={controller.saving} onClick={() => show({ kind: 'add' })}><UserRoundPlus aria-hidden="true" />添加成员</Button>}</div>
            <Members session={session} selectedId={selectedId} select={setSelectedId} />
            {member && <section id="member-controls" className="mt-4 rounded-xl border border-primary/15 bg-accent/30 p-4" aria-label="所选酒友的记酒操作"><div className="flex items-center justify-between gap-3"><h3 className="min-w-0 break-all font-medium">{member.name}</h3><span className="ml-auto shrink-0 text-xs text-muted-foreground">{finished ? '本局已结束' : `1 杯 = ${session.cupSize} 个`}</span>{!finished && <Button id="edit-member-button" type="button" variant="ghost" size="icon" aria-label={`编辑${member.name}`} disabled={controller.saving} onClick={() => show({ kind: 'edit', member })}><Pencil aria-hidden="true" /></Button>}</div>
              {finished ? <p className="mt-3 text-xs text-muted-foreground">已喝 {member.consumed} 个 · {member.cups} 杯 · 剩余待喝 {member.pending} 个</p> : <div className="mt-3 grid grid-cols-3 gap-3"><Button id="subtract-button" type="button" variant="outline" className="h-12 text-lg" disabled={controller.saving || member.pending < ledger.step} onClick={() => void run(async () => { await record(member.id, 'subtract', ledger.step); })} aria-label={`减少${ledger.step}个待喝`}><Minus aria-hidden="true" />{ledger.step}</Button><Button id="add-button" type="button" variant="outline" className="h-12 text-lg" disabled={controller.saving || member.pending + ledger.step > MAX_COUNT} onClick={() => void run(async () => { await record(member.id, 'add', ledger.step); })} aria-label={`增加${ledger.step}个待喝`}><Plus aria-hidden="true" />{ledger.step}</Button><Button id="drink-button" type="button" className="h-12 text-lg" title={`喝完一杯，扣减 ${session.cupSize} 个`} aria-label={`${member.name}喝完一杯，扣减${session.cupSize}个`} disabled={controller.saving || member.pending < session.cupSize || member.consumed + session.cupSize > MAX_COUNT} onClick={() => void run(async () => { await record(member.id, 'drink', ledger.step); })}><Wine aria-hidden="true" />−{session.cupSize}</Button></div>}
            </section>}
            <section className="mt-8 border-t pt-5"><div className="mb-2 flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-medium"><History aria-hidden="true" className="size-4 text-primary/70" />最近记录</h3><Button id="undo-button" type="button" variant="ghost" size="sm" disabled={finished || !controller.canUndo || controller.saving} onClick={() => void run(controller.undo)}><Undo2 aria-hidden="true" />撤销上一步</Button></div><Activities events={session.events.slice(0, 5)} /></section>
          </Card><div className="hidden lg:block"><RankingPanel session={session} /></div>
        </div></TabsContent>
        <TabsContent value="ranking" id="ranking-view" className="mx-auto mt-0 max-w-2xl"><RankingPanel session={session} /></TabsContent>
        <TabsContent value="history" id="history-view" className="m-0"><Card id="history-panel" role="region" aria-label="历史酒局"><h2 className="mb-5 flex items-center gap-3 text-lg font-semibold"><span className="flex size-9 items-center justify-center rounded-xl bg-accent text-primary"><History aria-hidden="true" className="size-4" /></span>历史酒局<span className="ml-3 rounded-full bg-muted px-2 py-1 text-xs font-normal">{ledger.history.length}</span></h2><div id="history-list" className="divide-y">{ledger.history.length ? ledger.history.map(archive => <button type="button" key={archive.id} data-testid={`history-${archive.id}`} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-5 text-left transition-colors hover:bg-accent/40" onClick={() => show({ kind: 'history', archive })}><span className="min-w-0"><strong className="block truncate font-medium">{archive.session.title}</strong><span className="mt-2 block text-xs text-muted-foreground">{dateTime(archive.session.startedAt)} · 第 {archive.session.round} 局</span><span className="mt-2 block text-xs text-muted-foreground">{archive.session.members.length} 位酒友 · 已喝 {archive.session.members.reduce((sum, item) => sum + item.consumed, 0)} 个</span></span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /></button>) : <p className="py-12 text-center text-sm text-muted-foreground">还没有历史酒局。结束本局或新开一局后，记录会保存在这里。</p>}</div><p className="border-t pt-5 text-xs leading-6 text-muted-foreground">历史酒局保留结束时的成员、计数、排行和最近 80 条操作记录，超过 30 天自动删除。</p></Card></TabsContent>
        <LedgerDialog state={dialog} ledger={ledger} controller={controller} close={close} show={show} restoreFocus={restoreFocus} />
      </>}
      <footer className="my-8 flex flex-wrap justify-between gap-3 border-t pt-5 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><ShieldCheck aria-hidden="true" className="size-3.5" />按设备保存 · 记录保留 30 天</span><span id="save-status" role="status" className="flex items-center gap-2"><CloudCheck aria-hidden="true" className="size-4 text-primary" />{controller.loading ? '正在加载…' : controller.saving ? '正在保存…' : controller.error ? '未同步 · 请重试' : '服务端已自动保存'}</span>{controller.localError && <div className="w-full"><p role="alert" className="break-words text-destructive">{controller.localError.message}</p><Button id="retry-local-storage" type="button" variant="link" disabled={controller.saving} onClick={() => void run(controller.repair)}>重试本地维护</Button></div>}</footer>
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-card/95 px-3 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_24px_#30284006] backdrop-blur-xl md:hidden" aria-label="移动导航"><TabsList className="grid w-full grid-cols-4 gap-2 rounded-none bg-transparent py-2 group-data-[orientation=horizontal]/tabs:h-[72px]">{nav.map(item => <TabsTrigger id={`mobile-${item.value}`} key={item.value} value={item.value} className="flex-col gap-1 rounded-xl text-[11px] data-[state=active]:bg-accent data-[state=active]:text-primary data-[state=active]:shadow-none"><item.icon aria-hidden="true" className="size-5" />{item.label}</TabsTrigger>)}<Button id="mobile-settings" type="button" variant="ghost" className="h-full flex-col gap-1 rounded-xl text-[11px] text-muted-foreground" disabled={!ledger || controller.saving} onClick={() => show({ kind: 'settings' })}><Settings aria-hidden="true" className="size-5" />设置</Button></TabsList></nav>
    {toast && <div id="toast" role="status" aria-live="polite" className="fixed bottom-24 left-1/2 z-40 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-foreground px-5 py-3 text-sm text-background shadow-lg md:bottom-6">{toast}</div>}
  </Tabs>;
}
