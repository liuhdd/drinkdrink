'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Drama, Hand, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useCharades } from '@/hooks/use-charades';

export function CharadesTool({ back }: { back: ReactNode }) {
  const game = useCharades();
  const current = game.current;
  const textSize = current && current.question.text.length > 16 ? 'text-2xl sm:text-4xl' : current && current.question.text.length > 8 ? 'text-3xl sm:text-5xl' : 'text-4xl sm:text-6xl';
  return <section id="charades-tool" aria-labelledby="charades-title" className="mx-auto max-w-2xl pb-20 lg:pb-0">
    <Card className="overflow-hidden p-0 sm:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-5 sm:px-7"><div className="flex items-center gap-2">{back}<div><h2 id="charades-title" tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold outline-none"><Drama aria-hidden="true" className="size-5 text-primary" />你比划我猜</h2><p className="mt-1.5 text-xs text-muted-foreground">面对面描述，让默契接住你的脑洞</p></div></div></div>
      <div className="px-5 pb-6 pt-6 sm:px-7 sm:pt-8">
        {current ? <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-xs"><span id="charades-category" className="rounded-full border border-primary/15 bg-accent/50 px-3 py-1.5 text-primary">{current.question.category}</span><span id="charades-progress" data-drawn={current.drawn} data-round={current.round} className="text-muted-foreground">第 {current.round} 轮 · {current.drawn} / {current.total}</span></div>
          <div className="flex min-h-56 items-center justify-center rounded-2xl border border-primary/10 bg-gradient-to-br from-accent/60 to-background px-5 py-10 sm:min-h-72 sm:px-8"><p id="charades-question" data-question-id={current.question.id} aria-live="polite" aria-atomic="true" className={`w-full break-words text-center font-semibold leading-relaxed tracking-wide ${textSize}`}>{current.question.text}</p></div>
          <p className="mt-4 text-center text-[11px] leading-6 text-muted-foreground">{current.drawn === current.total ? '本轮题目已全部出完，下一题将开启新一轮。' : `本轮还有 ${current.total - current.drawn} 道新题，出完自动重新洗牌。`}</p>
        </> : <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-sm text-muted-foreground" role="status">{game.busy && <Loader2 aria-hidden="true" className="size-7 animate-spin text-primary" />}<p>{game.busy ? '正在抽取一道题目…' : '题目未加载，请重新连接。'}</p></div>}
        {game.error && <div className="mt-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4"><p id="charades-error" role="alert" className="break-words text-xs leading-6 text-destructive">{game.error}</p><Button id="charades-retry" type="button" variant="outline" className="mt-3" disabled={game.busy} onClick={() => void game.load()}><RefreshCw aria-hidden="true" />重新连接</Button></div>}
        <div className="mt-6 rounded-xl bg-muted/60 p-4 text-xs leading-6 text-muted-foreground"><p className="flex items-center gap-2 font-medium text-foreground"><Hand aria-hidden="true" className="size-4 text-primary" />把屏幕给描述的人看</p><p className="mt-1">用动作或语言提示，别说出题目里的字。猜对了或想跳过，就点「下一题」。</p></div>
        <div className="mt-6 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(72px+env(safe-area-inset-bottom))] max-lg:z-20 max-lg:border-t max-lg:bg-card/95 max-lg:px-5 max-lg:py-2.5 max-lg:backdrop-blur-xl"><Button id="charades-next" type="button" className="h-12 w-full text-base" disabled={game.busy || !current || game.error !== null} onClick={() => void game.next()}>{game.busy ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <ArrowRight aria-hidden="true" className="size-5" />}{game.busy ? '正在取题…' : '下一题'}</Button></div>
      </div>
    </Card>
  </section>;
}
