import { History, Trophy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { leaderboard } from '@/shared/domain';
import { at } from '@/shared/values';
import type { LedgerEvent, Profile, Session } from '@/shared/types';

export const colors = [
  { bg: '#ffe2c8', fg: '#743207', name: '蜜橙' }, { bg: '#e0eade', fg: '#344b31', name: '鼠尾草' },
  { bg: '#deebf8', fg: '#294965', name: '雾蓝' }, { bg: '#efdef6', fg: '#674478', name: '丁香' },
  { bg: '#dbece8', fg: '#31574d', name: '薄荷' }, { bg: '#ffe4d8', fg: '#793f29', name: '蜜桃' },
];
export function dateTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
}
export function Avatar({ profile }: { profile: Pick<Profile, 'name' | 'color'> }) {
  const color = at(colors, profile.color);
  return <span aria-hidden="true" data-avatar className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ backgroundColor: color.bg, color: color.fg }}><img src={`/design/avatars/avatar-${profile.color}.webp`} alt="" width={96} height={96} className="size-full object-cover" /><span className="absolute right-0 bottom-0 flex size-4 items-center justify-center rounded-full text-[calc(10px*var(--appearance-text-scale))] font-semibold" style={{ backgroundColor: color.bg }}>{[...profile.name][0]}</span></span>;
}
// 结束后只展示最终计数，不再提供选择或操作。 Finished sessions show final counts without selection or actions.
function FinishedMembers({ session }: { session: Session }) {
  return <div id="members-grid" data-appearance-region="members" data-appearance-surface="card" className="ledger-list overflow-hidden rounded-lg" role="list" aria-label="本局酒友结果">
    {session.members.length ? session.members.map(member => <div key={member.id} role="listitem" data-testid={`member-card-${member.id}`} className="ledger-row flex items-center justify-between gap-3 px-4 py-3">
      <span className="flex min-w-0 items-center gap-3"><Avatar profile={member} /><span className="min-w-0"><strong data-testid={`member-${member.id}`} className="block truncate text-base font-semibold">{member.name}</strong><span data-testid={`result-pending-${member.id}`} className="mt-1 block text-[calc(11px*var(--appearance-text-scale))] text-muted-foreground">待喝 <span className="whitespace-nowrap">{member.pending.toLocaleString('zh-CN')} 个</span></span></span></span>
      <span className="flex shrink-0 flex-col items-end tabular-nums"><span className="flex items-baseline gap-1 text-primary"><span className="text-xs">已喝</span><strong data-testid={`result-consumed-${member.id}`} className="text-2xl font-semibold">{member.consumed.toLocaleString('zh-CN')}</strong><span className="text-xs">个</span></span><span data-testid={`result-cups-${member.id}`} className="text-[calc(11px*var(--appearance-text-scale))] text-muted-foreground">{member.cups.toLocaleString('zh-CN')} 杯</span></span>
    </div>) : <div className="py-12 text-center text-sm text-muted-foreground"><Users className="mx-auto mb-3 size-6" /><p>这一局没有添加成员</p></div>}
  </div>;
}
export function Members({ session, selectedId, select }: { session: Session; selectedId: string | null; select: (id: string) => void }) {
  if (session.endedAt !== undefined) return <FinishedMembers session={session} />;
  return <div id="members-grid" data-appearance-region="members" data-appearance-surface="card" className="ledger-list overflow-hidden rounded-lg" role="group" aria-label="选择酒友">
    {session.members.length ? session.members.map(member => <button key={member.id} type="button" data-testid={`member-${member.id}`} data-select-member={member.id} aria-pressed={selectedId === member.id} onClick={() => select(member.id)} className={cn('ledger-row flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-offset-[-3px]', selectedId === member.id && 'is-selected')}>
      <span className="flex min-w-0 items-center gap-3"><Avatar profile={member} /><span className="truncate text-base font-semibold">{member.name}</span></span>
      <span className="flex shrink-0 flex-col items-end"><strong className={cn('text-[calc(28px*var(--appearance-text-scale))] leading-[calc(2rem*var(--appearance-text-scale))] font-semibold tabular-nums', selectedId === member.id && 'text-primary')} data-testid={`pending-${member.id}`}>{member.pending.toLocaleString('zh-CN')}</strong><span className="text-[calc(11px*var(--appearance-text-scale))] text-muted-foreground">待喝</span></span>
    </button>) : <div className="py-12 text-center text-sm text-muted-foreground"><Users className="mx-auto mb-3 size-6" /><p>{session.endedAt === undefined ? '还没有酒友' : '这一局没有添加成员'}</p></div>}
  </div>;
}
export function Ranking({ session }: { session: Session }) {
  const ranked = leaderboard(session);
  const max = ranked[0]?.consumed || 1;
  return <div id="leaderboard" data-appearance-surface="card" className="ranking-list overflow-hidden rounded-lg">
    {ranked.length ? ranked.map(member => <div key={member.id} data-testid={`rank-${member.id}`} className={cn('ranking-row flex items-center gap-2.5 px-3 py-4 sm:gap-3 sm:px-4', member.consumed > 0 && member.rank === 1 && 'is-leading')}>
      <span aria-label={`第 ${member.rank} 名`} className={cn('flex w-5 shrink-0 flex-col items-center gap-0.5 text-xs font-semibold tabular-nums text-muted-foreground', member.consumed > 0 && member.rank === 1 && 'text-primary')}>{member.rank === 1 && member.consumed > 0 && <Trophy aria-hidden="true" className="size-4" />}{member.rank}</span>
      <Avatar profile={member} /><div className="min-w-0 flex-1"><p className="truncate text-base font-semibold">{member.name}</p><p className="mt-1 text-xs tabular-nums text-muted-foreground"><span>{member.cups} 杯</span><span className="ml-3">待喝 {member.pending} 个</span></p><div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70"><div className="h-full rounded-full bg-signal" style={{ width: `${member.consumed / max * 100}%` }} /></div></div>
      <span className="flex shrink-0 flex-col items-end"><strong className="text-[calc(28px*var(--appearance-text-scale))] leading-[calc(2rem*var(--appearance-text-scale))] font-semibold tabular-nums text-primary" data-testid={`consumed-${member.id}`}>{member.consumed}</strong><span className="text-[calc(10px*var(--appearance-text-scale))] text-muted-foreground">个已喝</span></span>
    </div>) : <p className="py-12 text-center text-sm text-muted-foreground">还没有排行</p>}
  </div>;
}
export function Activities({ events }: { events: readonly LedgerEvent[] }) {
  return <div id="activity-list" data-appearance-surface="card" className="divide-y divide-border overflow-hidden rounded-lg border-y border-border px-1">
    {events.length ? events.map(event => <div key={event.id} className="flex items-center gap-2.5 py-3 text-sm [&_[data-avatar]]:size-8 [&_[data-avatar]>span]:hidden">
      <Avatar profile={event} /><div className="min-w-0 flex-1 text-muted-foreground"><strong className="mr-2 break-all font-medium text-foreground">{event.name}</strong>{{ add: '加酒', subtract: '减酒', drink: '喝完一杯，扣减', set: '待喝调整为' }[event.action]} <span className="tabular-nums text-primary">{event.amount} 个</span></div>
      <time className="shrink-0 text-[calc(11px*var(--appearance-text-scale))] tabular-nums text-muted-foreground" dateTime={new Date(event.at).toISOString()}>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(event.at)}</time>
    </div>) : <p className="py-8 text-center text-sm text-muted-foreground">还没有记录</p>}
  </div>;
}
export function RankingPanel({ session }: { session: Session }) {
  return <section data-appearance-region="ranking" role="complementary" aria-label="单局排行榜">
    <h2 className="mb-4 text-xl font-bold">单局排行榜</h2>
    <Ranking session={session} />
    <div id="ranking-totals" data-appearance-region="ranking-totals" data-appearance-surface="card" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg p-4 text-sm"><span className="flex items-center gap-2 font-semibold"><Users aria-hidden="true" className="size-4 text-primary" />{session.members.length} 位酒友</span><span className="text-muted-foreground">合计已喝 <strong className="text-lg font-semibold tabular-nums text-primary">{session.members.reduce((sum, item) => sum + item.consumed, 0)}</strong> 个，<strong className="text-lg font-semibold tabular-nums text-primary">{session.members.reduce((sum, item) => sum + item.cups, 0)}</strong> 杯</span></div>
  </section>;
}
export function CloseButton({ close }: { close: () => void }) { return <Button type="button" variant="outline" onClick={close} data-testid="cancel-dialog">取消</Button>; }
