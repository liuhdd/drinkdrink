import { Button } from '@/components/ui/button';
import { cardLabel, type Card } from '@/shared/guandan';
import styles from './guandan.module.css';

const SUITS = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦', joker: '★' } as const;
export function rankLabel(rank: number): string { return rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : rank === 14 ? 'A' : String(rank); }

function CardFace({ card, level }: { card: Card; level: number }) {
  return <><span className={styles.rank}>{card.rank > 14 ? card.rank === 16 ? '大' : '小' : rankLabel(card.rank)}</span><span aria-hidden="true" className={styles.suit}>{SUITS[card.suit]}</span>{card.rank === level && <span className={styles.mark}>{card.suit === 'hearts' ? '配' : '级'}</span>}</>;
}
export function PlayingCard({ card, level, selected, disabled, onSelect }: { card: Card; level: number; selected: boolean; disabled: boolean; onSelect: () => void }) {
  const red = card.suit === 'hearts' || card.suit === 'diamonds' || card.rank === 16;
  return <Button id={`guandan-card-${card.id}`} data-testid="guandan-hand-card" data-card-id={card.id} type="button" variant="outline" aria-label={`${cardLabel(card)}${card.rank === level && card.suit === 'hearts' ? '，百搭牌' : ''}`} aria-pressed={selected} disabled={disabled} className={`${styles.card} ${red ? styles.red : ''} ${selected ? styles.selected : ''}`} onClick={onSelect}><CardFace card={card} level={level} /></Button>;
}
export function PlayedCards({ cards, level }: { cards: readonly Card[]; level: number }) {
  return <div className={styles.played}>{cards.map(card => <span key={card.id} className={`${styles.face} ${card.suit === 'hearts' || card.suit === 'diamonds' || card.rank === 16 ? styles.red : ''}`} aria-label={cardLabel(card)}><CardFace card={card} level={level} /></span>)}</div>;
}
