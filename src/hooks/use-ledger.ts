'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDeviceClient, SYNC_KEY } from '@/client/server-storage';
import { errorSnapshot } from '@/shared/protocol';
import { domainError, type Problem } from '@/shared/errors';
import { emptyLedger, restoreLedger, withLedgerSession } from '@/shared/persistence';
import { requireLedger } from '@/shared/values';
import { failureLog } from '@/shared/logging';
import type { DeviceClient, Ledger, Session, Snapshot } from '@/shared/types';

interface LoadedLedger { ledger: Ledger; revision: number; generation: string | null; }
interface Connection { client: DeviceClient | null; current: LoadedLedger | null; busy: boolean; dialogOpen: boolean; epoch: number; sequence: number; }
function loaded(snapshot: Snapshot): LoadedLedger {
  return { ledger: restoreLedger(snapshot.ledger ?? emptyLedger(Date.now())), revision: snapshot.revision, generation: snapshot.generation };
}
function failure(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
}

// React 连接器负责副作用；业务转换继续使用共享纯函数。 React owns connection effects; shared pure functions own domain transitions.
export function useLedger(dialogOpen: boolean) {
  const connection = useRef<Connection>({ client: null, current: null, busy: false, dialogOpen, epoch: 0, sequence: 0 });
  const [current, setCurrent] = useState<LoadedLedger | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<Problem | null>(null);
  const [notice, setNotice] = useState('');
  const [snapshots, setSnapshots] = useState<Session[]>([]);
  useEffect(() => { connection.current.dialogOpen = dialogOpen; }, [dialogOpen]);
  const apply = useCallback((value: Snapshot) => {
    const next = loaded(value);
    connection.current.current = next;
    connection.current.epoch++;
    setCurrent(next);
    return next;
  }, []);
  const client = useCallback((): DeviceClient => {
    if (!connection.current.client) throw domainError('记录客户端尚未初始化，请重新加载', 'React connector');
    return connection.current.client;
  }, []);
  const initialize = useCallback(async () => {
    if (connection.current.busy) throw domainError('正在加载或保存，请稍等', 'initialize ledger');
    connection.current.busy = true;
    setLoading(true);
    setError(null);
    try {
      connection.current.client ??= createDeviceClient({ storage: localStorage, fetch: globalThis.fetch, randomUUID: () => crypto.randomUUID() });
      const load = () => client().initialize();
      const result = navigator.locks?.request ? await navigator.locks.request('cheers-device-initialize', load) : await load();
      requireLedger(result.snapshot);
      apply(result.snapshot);
      setLocalError(result.localError);
      setSnapshots([]);
    } catch (caught) {
      const cause = failure(caught);
      console.error(failureLog('initialize ledger', cause));
      setError(cause.message);
    } finally { connection.current.busy = false; setLoading(false); }
  }, [apply, client]);
  const initialized = useRef(false);
  useEffect(() => { if (!initialized.current) { initialized.current = true; void initialize(); } }, [initialize]);

  const saveLedger = useCallback(async (ledger: Ledger, message: string): Promise<LoadedLedger> => {
    const previous = connection.current.current;
    if (!previous) throw domainError('记录尚未加载，请重新加载', 'save ledger');
    if (connection.current.busy) throw domainError('正在保存，请稍等', 'save ledger');
    if (previous.ledger.session.endedAt !== undefined && ledger.session.startedAt === previous.ledger.session.startedAt && ledger.session.round === previous.ledger.session.round) throw domainError('本局已结束，请新开一局', 'save ledger');
    connection.current.busy = true;
    setSaving(true);
    setError(null);
    try {
      const result = await client().save(ledger, previous.revision, previous.generation);
      requireLedger(result.snapshot);
      const next = apply(result.snapshot);
      setLocalError(result.localError);
      setNotice(result.localError?.message ?? message);
      return next;
    } catch (caught) {
      const cause = failure(caught);
      const conflict = errorSnapshot(cause);
      if (conflict) { apply(conflict); setSnapshots([]); }
      console.error(failureLog('save ledger', cause));
      setError(cause.message);
      throw cause;
    } finally { connection.current.busy = false; setSaving(false); }
  }, [apply, client]);
  const saveMember = useCallback(async (ledger: Ledger, message: string) => {
    const previous = connection.current.current?.ledger.session;
    if (!previous) throw domainError('记录尚未加载', 'save member');
    const next = await saveLedger(ledger, message);
    setSnapshots(items => [...items, structuredClone(previous)].slice(-30));
    return next;
  }, [saveLedger]);
  const undo = useCallback(async () => {
    const previous = snapshots.at(-1);
    const value = connection.current.current;
    if (!previous || !value) throw domainError('没有可以撤销的操作', 'undo');
    await saveLedger(withLedgerSession(value.ledger, previous, {}), '已撤销上一步');
    setSnapshots(items => items.slice(0, -1));
  }, [saveLedger, snapshots]);
  const repair = useCallback(async () => {
    if (connection.current.busy) throw domainError('正在保存，请稍等', 'repair local storage');
    connection.current.busy = true;
    setSaving(true);
    try {
      const snapshot = await client().repairLocalStorage();
      requireLedger(snapshot);
      if (snapshot.revision !== connection.current.current?.revision || snapshot.generation !== connection.current.current?.generation) setSnapshots([]);
      apply(snapshot);
      setLocalError(null);
      setError(null);
      setNotice('本地维护已完成');
    } finally { connection.current.busy = false; setSaving(false); }
  }, [apply, client]);
  const sync = useCallback(async () => {
    const state = connection.current;
    if (!state.current || state.busy || state.dialogOpen || document.hidden) return;
    const sequence = ++state.sequence;
    const epoch = state.epoch;
    try {
      const data = await client().load();
      if (state.sequence !== sequence || state.epoch !== epoch || state.busy || state.dialogOpen || !state.current) return;
      if (data.revision === state.current.revision && data.generation === state.current.generation) { setError(null); return; }
      if (data.generation === state.current.generation && data.revision < state.current.revision) return;
      apply(data);
      setSnapshots([]);
      setError(null);
      setNotice(data.ledger ? '已同步服务端记录' : '超过 30 天的记录已自动清理');
    } catch (caught) {
      const cause = failure(caught);
      console.error(failureLog('sync ledger', cause));
      if (sequence === state.sequence && epoch === state.epoch && !state.busy) setError(`同步失败：${cause.message}`);
    }
  }, [apply, client]);
  useEffect(() => {
    const storage = (event: StorageEvent) => { if (event.key === SYNC_KEY) void sync(); };
    const refresh = () => { void sync(); };
    window.addEventListener('storage', storage);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener('storage', storage); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.clearInterval(timer); };
  }, [sync]);
  useEffect(() => { if (!dialogOpen) void sync(); }, [dialogOpen, sync]);
  useEffect(() => {
    const report = (cause: Error) => { console.error(failureLog('browser connector', cause)); setError(cause.message); };
    const onError = (event: ErrorEvent) => report(failure(event.error ?? event.message));
    const onRejection = (event: PromiseRejectionEvent) => report(failure(event.reason));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  return { current, saving, loading, error, localError, notice, canUndo: snapshots.length > 0, initialize, saveLedger, saveMember, undo, repair, renameUndo: (title: string) => setSnapshots(items => items.map(item => ({ ...item, title }))), clearUndo: () => setSnapshots([]) };
}
export type LedgerController = ReturnType<typeof useLedger>;
