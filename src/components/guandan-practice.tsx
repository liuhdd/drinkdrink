'use client';

import { useState, type ReactNode } from 'react';
import { CircleHelp, Pause, Play, RotateCcw, Spade, Trophy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGuandan } from '@/hooks/use-guandan';
import { sortHand, type Game } from '@/shared/guandan';
import { GuandanRules } from './guandan-rules';
import { PlayedCards, PlayingCard, rankLabel } from './guandan-cards';
import styles from './guandan.module.css';

const SEATS = ['你', '下家', '对家', '上家'] as const;
function Seat({ game, player, className }: { game: Game; player: number; className: string }) {
  const place = game.finishOrder.indexOf(player);
  return <div id={`guandan-seat-${player}`} data-turn={game.status === 'playing' && game.turn === player} className={`${styles.seat} ${game.status === 'playing' && game.turn === player ? styles.active : ''} ${className}`}>
    <p className="truncate text-xs font-semibold">{SEATS[player]}<span className="ml-1 text-[10px] font-normal text-muted-foreground">{player === 2 ? '队友' : player === 0 ? '' : '电脑'}</span></p>
    <p className="mt-1 text-xs tabular-nums text-muted-foreground">{place >= 0 ? ['头游', '二游', '三游', '末游'][place] : <><strong id={`guandan-count-${player}`} className="text-base font-semibold text-foreground">{game.hands[player]!.length}</strong> 张</>}</p>
    {game.passed.includes(player) && <span className="text-[10px] text-muted-foreground">不出</span>}
  </div>;
}

export function GuandanPractice({ back }: { back: ReactNode }) {
  const [rules, setRules] = useState(false);
  const [restart, setRestart] = useState(false);
  const controller = useGuandan(rules || restart);
  const { game, selected, error, paused } = controller;
  const myTurn = game?.status === 'playing' && game.turn === 0 && !paused && !controller.busy;
  const last = game?.lastPlay;
  return <section id="guandan-tool" data-appearance-region="guandan" aria-labelledby="guandan-title" className="mx-auto max-w-3xl pb-[calc(var(--appearance-game-action-height)+11px)] lg:pb-4">
    <Card data-appearance-surface="game" className="gap-0 overflow-hidden p-0 sm:p-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-1">{back}<h2 id="guandan-title" tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold outline-none"><Spade aria-hidden="true" className="size-5 text-primary" />掼蛋</h2><span className="ml-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">本地练习</span></div><Button id="guandan-rules" type="button" variant="ghost" size="icon" aria-label="掼蛋规则" title="掼蛋规则" onClick={() => setRules(true)}><CircleHelp aria-hidden="true" /></Button></div>
      <div className="p-3 sm:p-6">
        {!controller.ready ? <p role="status" className="py-16 text-center text-sm text-muted-foreground">正在读取牌局…</p> : !game ? <div className="py-6 text-center">
          <img src="/design/tools/guandan.svg" alt="" width={160} height={120} className="mx-auto mb-5" />
          <h3 className="text-xl font-semibold">和对家一起，打到 A</h3>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">你 + 3 位电脑，两副牌、四人两队。随时开一局，练习配牌与出牌。</p>
          <Button id="guandan-start" type="button" className="mt-7 h-12 w-full max-w-xs" disabled={Boolean(error) || controller.busy} onClick={controller.start}><Users aria-hidden="true" />开始练习</Button>
          <p className="mt-4 text-xs text-muted-foreground">进度保存在本机，不自动记酒。</p>
        </div> : <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"><span>我方 <strong id="guandan-team-level">{rankLabel(game.levels[0])}</strong><span className="mx-2 text-muted-foreground">/</span>对方 <strong>{rankLabel(game.levels[1])}</strong></span><span id="guandan-level" className="rounded-md bg-secondary px-2 py-1 font-medium text-primary">第 {game.round} 局 · 打 {rankLabel(game.level)} · ♥{rankLabel(game.level)} 配</span></div>
          <div className={styles.table}>
            <Seat game={game} player={2} className="col-start-2 row-start-1" />
            <Seat game={game} player={3} className="col-start-1 row-start-2" />
            <div id="guandan-table" className="col-start-2 row-start-2 flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 text-center">
              {last ? <><p className="text-[10px] text-muted-foreground">{SEATS[last.player]}的上一手 · {last.cards.length} 张</p><PlayedCards cards={last.cards} level={game.level} /></> : <><Spade aria-hidden="true" className="size-8 text-primary/30" /><p className="text-xs text-muted-foreground">全新一局</p></>}
            </div>
            <Seat game={game} player={1} className="col-start-3 row-start-2" />
            <Seat game={game} player={0} className="col-start-2 row-start-3" />
          </div>
          <p id="guandan-status" role="status" className="mt-3 min-h-5 text-center text-sm font-medium text-primary">{game.status !== 'playing' ? '本局已结束' : paused ? '练习已暂停' : myTurn ? game.table ? '轮到你了，请跟牌或选择不出' : '轮到你领出一手牌' : `${SEATS[game.turn]}正在思考…`}</p>
          <p id="guandan-last-action" className="mt-1 min-h-4 text-center text-[11px] text-muted-foreground">{game.lastAction}</p>
          {game.result && <div id="guandan-result" className="mt-4 rounded-lg border bg-secondary/70 p-4 text-center"><Trophy aria-hidden="true" className="mx-auto mb-2 size-6 text-primary" /><h3 className="font-semibold">{game.result.winner === 0 ? '我方获胜' : '对方获胜'}{game.result.matchWon ? '，成功通关！' : `，升 ${game.result.upgrade} 级`}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{game.result.order.map((player, index) => `${index + 1}. ${SEATS[player]}`).join('　')}</p><Button id="guandan-next-round" type="button" className="mt-4 w-full" disabled={Boolean(error) || controller.busy} onClick={game.status === 'match-over' ? () => setRestart(true) : controller.next}>{game.status === 'match-over' ? '再练一场' : '下一局'}</Button></div>}
          <div className="mt-4 flex items-center justify-between"><h3 className="text-xs font-semibold">你的手牌 <span id="guandan-hand-count" className="ml-1 font-normal text-muted-foreground">{game.hands[0]!.length} 张</span></h3><span id="guandan-selection-count" className="text-[11px] text-muted-foreground">{selected.length ? `已选 ${selected.length} 张` : '点选出牌'}</span></div>
          <div id="guandan-hand" className={styles.hand}>{sortHand(game.hands[0]!, game.level).map(card => <PlayingCard key={card.id} card={card} level={game.level} selected={selected.includes(card.id)} disabled={!myTurn || Boolean(error)} onSelect={() => controller.toggle(card.id)} />)}</div>
          {controller.notice && <p id="guandan-notice" role="status" className="mt-2 text-xs leading-5 text-primary">{controller.notice}</p>}
          <div id="guandan-actions" data-appearance-surface="toolbar" className="mt-3 grid grid-cols-3 gap-2 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(var(--appearance-navigation-height)+env(safe-area-inset-bottom))] max-lg:z-20 max-lg:border-t max-lg:bg-card/95 max-lg:px-5 max-lg:py-2.5 max-lg:backdrop-blur-xl"><Button id="guandan-pass" type="button" variant="outline" disabled={!myTurn || !game.table || Boolean(error)} onClick={controller.pass}>不出</Button><Button id="guandan-hint" type="button" variant="outline" disabled={!myTurn || Boolean(error)} onClick={controller.suggest}>提示</Button><Button id="guandan-play" type="button" disabled={!myTurn || selected.length === 0 || Boolean(error)} onClick={controller.play}>出牌</Button></div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1"><Button id="guandan-clear" type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" disabled={selected.length === 0} onClick={controller.clear}>取消选择</Button><div className="flex gap-1"><Button id="guandan-pause" type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" disabled={game.status !== 'playing'} onClick={controller.togglePause}>{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{paused ? '继续' : '暂停'}</Button><Button id="guandan-restart" type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setRestart(true)}><RotateCcw aria-hidden="true" />重开</Button></div></div>
          {game.tributeLog.length > 0 && <details id="guandan-tribute" className="mt-3 border-t pt-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">本局进贡（自动完成）</summary><ul className="mt-2 space-y-1 leading-5">{game.tributeLog.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        </>}
        {error && <div className="mt-4 rounded-md border border-destructive/40 p-3"><p id="guandan-error" role="alert" className="break-words text-xs leading-5 text-destructive">{error}</p><div className="mt-2 flex flex-wrap gap-2"><Button id="guandan-reload" type="button" variant="outline" size="sm" onClick={controller.reload}>重试读取</Button><Button id="guandan-error-restart" type="button" variant="ghost" size="sm" onClick={() => setRestart(true)}>重新开局</Button></div></div>}
      </div>
    </Card>
    <GuandanRules open={rules} onOpenChange={setRules} description="你与对家组队，对战两位电脑。纯本机练习，不连接其他玩家。" persistence="电脑使用基础策略。牌局保存在当前浏览器；清除网站数据会移除进度。" />
    <Dialog open={restart} onOpenChange={setRestart}><DialogContent id="guandan-restart-dialog" data-appearance-region="guandan"><DialogHeader><DialogTitle>重新开始练习？</DialogTitle><DialogDescription>当前掼蛋牌局和级数将被新牌局替换，从 2 开始。酒局账本不受影响。</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button id="guandan-restart-cancel" type="button" variant="outline" onClick={() => setRestart(false)}>取消</Button><Button id="guandan-restart-confirm" type="button" onClick={() => { void controller.start(); setRestart(false); }}>重新开始</Button></div></DialogContent></Dialog>
  </section>;
}
