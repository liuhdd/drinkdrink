'use client';

import { useState, type ReactNode } from 'react';
import { Dices, Loader2, RotateCcw, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useDice } from '@/hooks/use-dice';
import { DiceScene } from './dice-scene';

export function DiceTool({ back }: { back: ReactNode }) {
  const dice = useDice();
  const [countOpen, setCountOpen] = useState(false);
  const revealed = dice.phase === 'settled' && dice.lift >= 155;
  const opening = Math.round(dice.lift / 180 * 100);
  const status = dice.phase === 'covering' ? '正在盖好骰盅…' : dice.phase === 'shaking' ? '正在摇骰子…' : dice.phase === 'ready' ? '准备好了，摇一把试试' : revealed ? '已揭盅，看看你的手气' : opening > 0 ? '轻轻揭开，只看一点点' : '摇好了，向上滑动揭盅';
  return <section data-appearance-region="dice" aria-labelledby="dice-title" className="mx-auto max-w-4xl"><Dialog open={countOpen} onOpenChange={setCountOpen}>
    <Card id="dice-tool" data-appearance-surface="game" className="overflow-hidden p-0 sm:p-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-3 sm:px-5"><div className="flex min-w-0 items-center gap-2">{back}<h2 id="dice-title" tabIndex={-1} className="flex items-center gap-2 whitespace-nowrap text-lg font-semibold outline-none">摇骰子</h2></div><div className="flex shrink-0 items-center gap-1"><DialogTrigger asChild><Button id="dice-count-toggle" type="button" variant="outline" className="px-2" aria-label="骰子数量" aria-expanded={countOpen} aria-controls="dice-count-dialog" disabled={dice.busy}><SlidersHorizontal aria-hidden="true" /><span className="hidden min-[375px]:inline">骰子数量</span></Button></DialogTrigger><Button id="dice-sound" type="button" variant="ghost" size="icon" aria-label={dice.soundEnabled ? '关闭摇骰音效' : '开启摇骰音效'} aria-pressed={dice.soundEnabled} disabled={dice.busy} onClick={dice.toggleSound}>{dice.soundEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}</Button></div></div>
      <p id="dice-status" role="status" aria-live="polite" className="sr-only">{status}</p>
      <div>
        <div className="relative min-w-0 bg-[radial-gradient(ellipse_at_50%_65%,var(--color-accent),transparent_70%)]">
          <div id="dice-gesture" role="slider" tabIndex={0} aria-label="揭开骰盅" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={opening} aria-valuetext={opening === 0 ? '骰盅已盖好' : `骰盅已揭开 ${opening}%`} aria-disabled={dice.phase !== 'settled'} aria-describedby="dice-status" className={`touch-none select-none rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 ${dice.phase === 'settled' ? dice.dragging ? 'cursor-grabbing' : 'cursor-grab' : ''}`} onPointerDown={dice.pointerDown} onPointerMove={dice.pointerMove} onPointerUp={dice.pointerEnd} onPointerCancel={dice.pointerEnd} onLostPointerCapture={dice.pointerEnd} onKeyDown={dice.keyDown}>
            <DiceScene values={dice.values} lift={dice.lift} phase={dice.phase} dragging={dice.dragging} />
          </div>
        </div>
        <div className="mx-auto flex max-w-sm flex-col gap-5 px-5 pb-5 sm:pb-7">
          <div data-appearance-surface="toolbar" className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(var(--appearance-navigation-height)+env(safe-area-inset-bottom))] max-lg:z-20 max-lg:border-t max-lg:bg-card/95 max-lg:px-5 max-lg:py-2.5 max-lg:backdrop-blur-xl">{dice.error && <p id="dice-error" role="alert" className="mb-2 break-words text-xs leading-6 text-destructive">{dice.error}</p>}<Button id="dice-shake" type="button" className="h-12 w-full text-base" disabled={dice.busy} onClick={() => void dice.shake()}>{dice.busy ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : dice.phase === 'ready' ? <Dices aria-hidden="true" className="size-5" /> : <RotateCcw aria-hidden="true" className="size-4" />}{dice.busy ? '摇骰中…' : dice.phase === 'ready' ? '摇骰子' : '再摇一次'}</Button></div>
        </div>
      </div>
    </Card>
    {countOpen && <DialogContent id="dice-count-dialog" data-appearance-region="dice-settings" data-appearance-surface="card" aria-modal="true" className="max-h-[85dvh] overflow-y-auto bg-card sm:max-w-sm"><DialogHeader className="text-left"><DialogTitle>骰子数量</DialogTitle><DialogDescription className="sr-only">选择 1 到 6 颗骰子</DialogDescription></DialogHeader><fieldset id="dice-count-settings" disabled={dice.busy}><legend className="sr-only">骰子数量</legend><div className="grid grid-cols-3 gap-3">{[1, 2, 3, 4, 5, 6].map(count => <Button id={`dice-count-${count}`} key={count} type="button" variant={dice.values.length === count ? 'default' : 'outline'} className="h-12 min-w-0 px-0 text-lg" aria-label={`${count}颗骰子`} aria-pressed={dice.values.length === count} onClick={() => dice.changeCount(count)}>{count}</Button>)}</div></fieldset><DialogClose asChild><Button id="dice-count-done" type="button" className="w-full">完成</Button></DialogClose></DialogContent>}
  </Dialog></section>;
}
