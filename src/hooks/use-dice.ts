import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { createDiceAudio, type DiceAudio } from '@/client/dice-audio';
import type { DicePhase, DiceValue } from '@/components/dice-scene';
import { failureLog } from '@/shared/logging';

interface DiceState { values: readonly DiceValue[]; phase: DicePhase; lift: number; }
interface CupDrag { pointerId: number; startY: number; startLift: number; }
const INITIAL_VALUES: readonly DiceValue[] = [1, 2, 3, 4, 5];
const FACES: readonly DiceValue[] = [1, 2, 3, 4, 5, 6];

function rollDice(count: number): readonly DiceValue[] {
  return Array.from({ length: count }, () => {
    // 拒绝尾部余数，让六个点数等概率。 / Reject the remainder for six equally likely faces.
    let sample = 255;
    while (sample >= 252) sample = crypto.getRandomValues(new Uint8Array(1))[0]!;
    return FACES[sample % 6]!;
  });
}

/** 浏览器中的摇骰、音频和手势生命周期。 / Browser lifecycle for rolling, audio and cup gestures. */
export function useDice() {
  const [state, setState] = useState<DiceState>({ values: INITIAL_VALUES, phase: 'ready', lift: 0 });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<DiceAudio | null>(null);
  const timer = useRef<number | null>(null);
  const drag = useRef<CupDrag | null>(null);
  const run = useRef(0);
  const rolling = useRef(false);
  const busy = state.phase === 'covering' || state.phase === 'shaking';

  useEffect(() => () => {
    run.current += 1;
    if (timer.current !== null) window.clearTimeout(timer.current);
    const player = audio.current;
    audio.current = null;
    player?.stop();
    void player?.dispose().catch(caught => {
      if (!(caught instanceof Error)) throw caught;
      console.error(failureLog('dispose dice audio', caught));
    });
  }, []);

  function changeCount(count: number): void {
    if (rolling.current) return;
    if (!Number.isInteger(count) || count < 1 || count > 6) throw new RangeError('骰子数量必须是 1 到 6 的整数');
    setState({ values: FACES.slice(0, count), phase: 'ready', lift: 0 });
    setError('');
  }

  async function shake(): Promise<void> {
    if (rolling.current) return;
    rolling.current = true;
    const currentRun = ++run.current;
    drag.current = null;
    setDragging(false);
    setError('');
    setState(previous => ({ ...previous, phase: 'covering', lift: 0 }));
    try {
      // 点击时解锁音频，盖盅完成后才发声。 / Unlock audio on click, play only after covering.
      const preparation = soundEnabled ? (audio.current ??= createDiceAudio()).prepare() : Promise.resolve();
      const covered = new Promise<void>(resolve => { timer.current = window.setTimeout(resolve, 300); });
      await Promise.all([preparation, covered]);
      if (currentRun !== run.current) return;
      const values = rollDice(state.values.length);
      if (soundEnabled) audio.current!.start();
      setState(previous => ({ ...previous, phase: 'shaking', lift: 0 }));
      timer.current = window.setTimeout(() => {
        audio.current?.stop();
        rolling.current = false;
        timer.current = null;
        setState({ values, phase: 'settled', lift: 0 });
      }, 1240);
    } catch (caught) {
      if (currentRun !== run.current) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      audio.current?.stop();
      rolling.current = false;
      setState(previous => ({ ...previous, phase: 'ready', lift: 0 }));
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (state.phase !== 'settled' || drag.current !== null || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startLift: state.lift };
    setDragging(true);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const currentDrag = drag.current;
    if (currentDrag === null || event.pointerId !== currentDrag.pointerId) return;
    const lift = Math.max(0, Math.min(180, currentDrag.startLift + currentDrag.startY - event.clientY));
    setState(previous => ({ ...previous, lift }));
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>): void {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (state.phase !== 'settled') return;
    const positions: Readonly<Record<string, number>> = { ArrowUp: state.lift + 10, ArrowDown: state.lift - 10, Home: 0, End: 180 };
    const position = positions[event.key];
    if (position === undefined) return;
    event.preventDefault();
    setState(previous => ({ ...previous, lift: Math.max(0, Math.min(180, position)) }));
  }

  function toggleSound(): void {
    if (!rolling.current) setSoundEnabled(previous => !previous);
  }

  return { ...state, soundEnabled, dragging, error, busy, changeCount, shake, toggleSound, pointerDown, pointerMove, pointerEnd, keyDown };
}
