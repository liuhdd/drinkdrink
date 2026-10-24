'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createCharadesClient, type CharadesClient } from '@/client/charades';
import type { CharadesSnapshot } from '@/shared/charades';
import { domainError } from '@/shared/errors';
import { failureLog } from '@/shared/logging';

interface Connection { client: CharadesClient | null; busy: boolean; mounted: boolean; sequence: number; }

export function useCharades() {
  const connection = useRef<Connection>({ client: null, busy: false, mounted: false, sequence: 0 });
  const [current, setCurrent] = useState<CharadesSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const execute = useCallback(async (operation: (client: CharadesClient) => Promise<CharadesSnapshot>) => {
    const state = connection.current;
    if (state.busy) return;
    state.busy = true;
    const sequence = ++state.sequence;
    setBusy(true);
    setError(null);
    try {
      state.client ??= createCharadesClient({ storage: localStorage, fetch: globalThis.fetch, randomUUID: () => crypto.randomUUID() });
      const snapshot = await operation(state.client);
      if (state.mounted && sequence === state.sequence) setCurrent(snapshot);
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      console.error(failureLog('charades', cause));
      if (state.mounted && sequence === state.sequence) setError(cause.message);
    } finally {
      state.busy = false;
      if (state.mounted && sequence === state.sequence) setBusy(false);
    }
  }, []);
  const load = useCallback(() => execute(client => client.load()), [execute]);
  useEffect(() => {
    connection.current.mounted = true;
    void load();
    return () => { connection.current.mounted = false; };
  }, [load]);
  const next = () => execute(client => {
    if (!current) throw domainError('题目尚未加载，请重新连接', 'next charades prompt');
    return client.next(current);
  });
  return { current, busy, error, load, next };
}
