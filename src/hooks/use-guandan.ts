'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GUANDAN_STORAGE_KEY, loadGuandanGame, saveGuandanGame } from '@/client/guandan-storage';
import { chooseAiAction, createDeck, createGame, legalPlays, nextRound, passTurn, playCards, shuffleDeck, type Game } from '@/shared/guandan';

function random(): number { return crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296; }

/** 控制本地牌局、电脑行动和离开页面时的定时器清理。 Own the local game, computer turns and timer cleanup when leaving the tool. */
export function useGuandan(dialogOpen: boolean) {
  const [game, setGame] = useState<Game | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const current = useRef<Game | null>(null);
  const stored = useRef<string | null>(null);
  const loaded = useRef(false);
  const mounted = useRef(false);
  const saving = useRef(false);
  const lifecycle = useRef(0);
  const report = useCallback((caught: unknown) => {
    if (!(caught instanceof Error)) throw caught;
    if (mounted.current) setError(caught.message);
  }, []);
  const reload = useCallback(() => {
    try {
      const next = loadGuandanGame(localStorage);
      current.current = next.game;
      stored.current = next.raw;
      loaded.current = true;
      setGame(next.game);
      setSelected([]);
      setError('');
      setNotice('');
    } catch (caught) { loaded.current = false; report(caught); }
    finally { setReady(true); }
  }, [report]);
  useEffect(() => {
    mounted.current = true;
    reload();
    const sync = (event: StorageEvent) => { if (event.key === GUANDAN_STORAGE_KEY || event.key === null) reload(); };
    const visibility = () => setVisible(!document.hidden);
    visibility();
    window.addEventListener('storage', sync);
    document.addEventListener('visibilitychange', visibility);
    return () => { lifecycle.current++; mounted.current = false; window.removeEventListener('storage', sync); document.removeEventListener('visibilitychange', visibility); };
  }, [reload]);

  useEffect(() => { lifecycle.current++; }, [dialogOpen, paused, visible]);

  const save = useCallback(async (next: Game, expected: string | null, canSave: () => boolean) => {
    if (!navigator.locks) throw new Error('当前浏览器不支持安全保存牌局所需的 Web Locks。请使用新版浏览器并通过 HTTPS 或本机地址打开。');
    // 用浏览器锁串行化多窗口写入，期望值在排队前固定。 Serialize cross-window writes and capture the expected snapshot before waiting.
    await navigator.locks.request(GUANDAN_STORAGE_KEY, () => {
      if (!mounted.current || !canSave()) return;
      const raw = saveGuandanGame(localStorage, next, expected);
      stored.current = raw;
      current.current = next;
      loaded.current = true;
      setGame(next);
      setSelected([]);
      setError('');
      setNotice('');
    });
  }, []);
  const change = useCallback(async (operation: (previous: Game) => Game) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      if (!loaded.current || !current.current) throw new Error('请先成功读取或开始一局掼蛋。');
      const previous = current.current;
      const generation = lifecycle.current;
      await save(operation(previous), stored.current, () => current.current === previous && lifecycle.current === generation);
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'GuandanRuleError' && current.current?.turn === 0) setNotice(caught.message);
      else report(caught);
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  }, [report, save]);
  useEffect(() => {
    if (!game || game.status !== 'playing' || game.turn === 0 || paused || busy || dialogOpen || !visible || error) return;
    const timer = window.setTimeout(() => {
      if (current.current !== game) return;
      void change(previous => {
        const action = chooseAiAction(previous);
        return action.type === 'play' ? playCards(previous, previous.turn, action.cardIds) : passTurn(previous, previous.turn);
      });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [game, paused, busy, dialogOpen, visible, error, change]);

  async function start(): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      // 仅在用户明确开始或确认重新开局时替换旧记录。 Replace saved progress only on explicit start or confirmed restart.
      const expected = localStorage.getItem(GUANDAN_STORAGE_KEY);
      await save(createGame({ id: crypto.randomUUID(), deck: shuffleDeck(createDeck(), random), firstPlayer: 0 }), expected, () => mounted.current);
      if (mounted.current) setPaused(false);
    } catch (caught) { report(caught); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  function toggle(cardId: string): void {
    if (game?.turn !== 0 || game.status !== 'playing' || paused || busy || error) return;
    setSelected(previous => previous.includes(cardId) ? previous.filter(id => id !== cardId) : [...previous, cardId]);
    setNotice('');
  }
  function suggest(): void {
    if (!game || game.turn !== 0 || game.status !== 'playing' || paused || busy || error) return;
    try {
      const options = legalPlays(game, 0);
      const previous = options.findIndex(cards => cards.length === selected.length && cards.every(card => selected.includes(card.id)));
      const index = (previous + 1) % Math.max(1, options.length);
      const cards = options[index];
      setSelected(cards?.map(card => card.id) ?? []);
      setNotice(cards ? `提示 ${index + 1} / ${options.length}，再次点击可换一组。` : '没有能压过的牌，可以选择不出。');
    } catch (caught) { report(caught); }
  }
  return {
    game, selected, ready, error, notice, paused, busy, start, reload, toggle, suggest,
    clear: () => { setSelected([]); setNotice(''); },
    play: () => void change(previous => playCards(previous, 0, selected)),
    pass: () => void change(previous => passTurn(previous, 0)),
    next: () => void change(previous => nextRound(previous, { id: crypto.randomUUID(), deck: shuffleDeck(createDeck(), random) })),
    togglePause: () => setPaused(previous => !previous),
  };
}
