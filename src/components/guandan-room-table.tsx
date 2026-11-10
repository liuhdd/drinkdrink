import type { RoomSnapshot } from '@/shared/guandan-room';
import { sortHand } from '@/shared/guandan';
import { Button } from '@/components/ui/button';
import { PlayedCards, PlayingCard, rankLabel } from './guandan-cards';
import type { useGuandanRoom } from '@/hooks/use-guandan-room';
import styles from './guandan.module.css';

type Controller = ReturnType<typeof useGuandanRoom>;
export function GuandanRoomTable({ room, controller }: { room: RoomSnapshot; controller: Controller }) {
  const game = room.game;
  if (!game) return null;
  const self = room.selfSeat;
  const myTurn = room.status === 'playing' && game.status === 'playing' && self === game.turn && !controller.busy && !controller.error;
  const name = (seat: number) => room.seats.find(item => item.seat === seat)?.name ?? `座位 ${seat + 1}`;
  const positions = ['col-start-2 row-start-3', 'col-start-3 row-start-2', 'col-start-2 row-start-1', 'col-start-1 row-start-2'];
  return <>
    <div className="mb-3 flex flex-wrap justify-between gap-2 text-xs"><span>第 {game.round} 局 · 打 {rankLabel(game.level)} · ♥{rankLabel(game.level)} 配</span><span>队伍一 {rankLabel(game.levels[0])} / 队伍二 {rankLabel(game.levels[1])}</span></div>
    <div className={styles.table}>{room.seats.map(seat => {
      const relative = (seat.seat - (self ?? 0) + 4) % 4;
      const place = game.finishOrder.indexOf(seat.seat);
      return <div key={seat.seat} id={`guandan-room-seat-${seat.seat}`} data-turn={game.turn === seat.seat && game.status === 'playing'} className={`${styles.seat} ${positions[relative]} ${game.turn === seat.seat && game.status === 'playing' ? styles.active : ''}`}>
        <p className="truncate text-xs font-semibold">{seat.name}{seat.seat === self ? '（你）' : relative === 2 ? '（队友）' : ''}</p><p className="mt-1 text-xs text-muted-foreground">{seat.kind === 'bot' ? '电脑 · ' : ''}{place >= 0 ? ['头游', '二游', '三游', '末游'][place] : <><strong id={`guandan-room-count-${seat.seat}`}>{game.handCounts[seat.seat]}</strong> 张</>}</p>{game.passed.includes(seat.seat) && <span className="text-[10px]">不出</span>}
      </div>;
    })}<div id="guandan-room-table" className="col-start-2 row-start-2 flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 text-center">{game.lastPlay ? <><p className="text-[10px] text-muted-foreground">{name(game.lastPlay.player)}的上一手</p><PlayedCards cards={game.lastPlay.cards} level={game.level} /></> : <p className="text-xs text-muted-foreground">等待领出</p>}</div></div>
    <p id="guandan-room-status" role="status" className="mt-3 text-center text-sm font-medium text-primary">{game.status !== 'playing' ? '本局结束' : game.turn === self ? game.table ? '轮到你跟牌或不出' : '轮到你领出' : `等待 ${name(game.turn)} 出牌`}</p>
    {game.result && <div id="guandan-room-result" className="my-4 rounded-lg bg-secondary p-4 text-center"><h3 className="font-semibold">队伍{game.result.winner === 0 ? '一' : '二'}获胜{game.result.matchWon ? '，成功通关！' : `，升 ${game.result.upgrade} 级`}</h3><p className="mt-2 text-xs">{game.result.order.map((seat, index) => `${index + 1}. ${name(seat)}`).join('　')}</p>{self === room.hostSeat && game.status === 'round-over' && <Button id="guandan-room-next" className="mt-3" disabled={controller.busy || Boolean(controller.error)} onClick={() => void controller.action('next')}>下一局</Button>}{game.status === 'match-over' && <p className="mt-2 text-xs">整场已结束，可由房主关闭后重新组局。</p>}</div>}
    <div className="mt-4 flex justify-between text-xs"><h3 className="font-semibold">你的手牌 · {game.hand.length} 张</h3><span>已选 {controller.selected.length} 张</span></div>
    <div id="guandan-room-hand" className={styles.hand}>{sortHand(game.hand, game.level).map(card => <PlayingCard key={card.id} card={card} level={game.level} selected={controller.selected.includes(card.id)} disabled={!myTurn} onSelect={() => controller.toggle(card.id)} />)}</div>
    <p role="status" className="mt-2 min-h-5 text-xs text-primary">{controller.notice}</p>
    <div id="guandan-room-actions" data-appearance-surface="toolbar" className="mt-3 grid grid-cols-3 gap-2 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(var(--appearance-navigation-height)+env(safe-area-inset-bottom))] max-lg:z-20 max-lg:border-t max-lg:bg-card/95 max-lg:px-5 max-lg:py-2.5 max-lg:backdrop-blur-xl"><Button id="guandan-room-pass" variant="outline" disabled={!myTurn || !game.table} onClick={() => void controller.action('pass')}>不出</Button><Button id="guandan-room-hint" variant="outline" disabled={!myTurn} onClick={controller.suggest}>提示</Button><Button id="guandan-room-play" disabled={!myTurn || !controller.selected.length} onClick={() => void controller.action('play')}>出牌</Button></div>
    <Button id="guandan-room-clear" variant="ghost" size="sm" disabled={!controller.selected.length} onClick={controller.clear}>取消选择</Button>
    {game.tributeLog.length > 0 && <p className="mt-2 text-xs text-muted-foreground">本局进退贡由服务端自动完成。</p>}
  </>;
}
