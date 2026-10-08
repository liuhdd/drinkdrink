import { Check, Martini, History, Trophy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { leaderboard } from '@/shared/domain';
import { at } from '@/shared/values';
import type { LedgerEvent, Profile, Session } from '@/shared/types';

export const colors = [
  { bg: '#e8ddff', fg: '#6240a0', name: '薰衣草' }, { bg: '#eddefa', fg: '#765099', name: '丁香紫' },
  { bg: '#f5dff6', fg: '#8d4c87', name: '樱花紫' }, { bg: '#e4e7ff', fg: '#4f579d', name: '雾蓝' },
  { bg: '#ede0f3', fg: '#755285', name: '葡萄紫' }, { bg: '#ebe7f3', fg: '#6a6082', name: '银灰紫' },
];
export function dateTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);
}
export function Avatar({ profile }: { profile: Pick<Profile, 'name' | 'color'> }) {
  const color = at(colors, profile.color);
  return <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-2xl font-medium ring-1 ring-black/5 ring-inset" style={{ backgroundColor: color.bg, color: color.fg }}>{[...profile.name][0]}</span>;
}
export function Members({ session, selectedId, select }: { session: Session; selectedId: string | null; select: (id: string) => void }) {
  return <div id="members-grid" className="grid gap-2" role="group" aria-label="选择酒友">
    {session.members.length ? session.members.map(member => <button key={member.id} type="button" data-testid={`member-${member.id}`} data-select-member={member.id} aria-pressed={selectedId === member.id} onClick={() => select(member.id)} className={cn('flex w-full items-center justify-between gap-3 rounded-xl border border-transparent bg-background/70 px-4 py-4 text-left transition-colors hover:border-primary/20 hover:bg-accent/40 focus-visible:outline-offset-0', selectedId === member.id && 'border-primary/30 bg-accent/70')}>
      <span className="flex min-w-0 items-center gap-3"><Avatar profile={member} /><span className="truncate font-medium">{member.name}</span>{selectedId === member.id && <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check aria-hidden="true" className="size-3" /></span>}</span>
      <span className="shrink-0 text-right"><strong className="text-2xl font-semibold tabular-nums text-foreground" data-testid={`pending-${member.id}`}>{member.pending.toLocaleString('zh-CN')}</strong><span className="mt-0.5 block text-[10px] text-muted-foreground">个待喝</span></span>
    </button>) : <div className="p-10 text-center text-sm text-muted-foreground"><Users className="mx-auto mb-3 size-7" /><p>{session.endedAt === undefined ? '添加酒友，开始记录今晚的每一杯。' : '这一局没有添加成员。'}</p></div>}
  </div>;
}
export function Ranking({ session }: { session: Session }) {
  const ranked = leaderboard(session);
  const max = ranked[0]?.consumed || 1;
  return <div id="leaderboard" className="divide-y">
    {ranked.length ? ranked.map(member => <div key={member.id} data-testid={`rank-${member.id}`} className="flex items-center gap-3 py-5">
      <span aria-label={`第 ${member.rank} 名`} className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-medium tabular-nums text-muted-foreground', member.consumed > 0 && member.rank <= 3 && 'bg-accent text-primary')}>{member.rank === 1 && member.consumed > 0 ? <Trophy aria-hidden="true" className="size-4" /> : String(member.rank).padStart(2, '0')}</span>
      <Avatar profile={member} /><div className="min-w-0 flex-1"><p className="truncate font-medium">{member.name}</p><p className="mt-1 text-xs text-muted-foreground">{member.cups} 杯 · 还待喝 {member.pending} 个</p><div aria-hidden="true" className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-primary/40 to-primary/80" style={{ width: `${member.consumed / max * 100}%` }} /></div></div>
      <span className="shrink-0 text-primary"><strong className="mr-1 text-2xl font-semibold tabular-nums" data-testid={`consumed-${member.id}`}>{member.consumed}</strong><span className="text-xs">个</span></span>
    </div>) : <p className="py-12 text-center text-sm text-muted-foreground">添加酒友后，排行从这里开始。</p>}
  </div>;
}
export function Activities({ events }: { events: readonly LedgerEvent[] }) {
  return <div id="activity-list" className="divide-y">
    {events.length ? events.map(event => <div key={event.id} className="flex items-center gap-3 py-3 text-sm">
      <Avatar profile={event} /><div className="min-w-0 flex-1 text-muted-foreground"><strong className="mr-2 break-all font-medium text-foreground">{event.name}</strong>{{ add: '加酒', subtract: '减酒', drink: '喝完一杯，扣减', set: '待喝调整为' }[event.action]} <span className="text-primary">{event.amount} 个</span></div>
      <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(event.at).toISOString()}>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(event.at)}</time>
    </div>) : <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><History className="size-4" />每次加减、喝完都会记在这里</p>}
  </div>;
}
export function RankingPanel({ session }: { session: Session }) {
  return <Card role="complementary" aria-label="单局排行榜">
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary"><Trophy aria-hidden="true" className="size-5" /></span><div><p className="mb-1 text-[9px] tracking-[.18em] text-muted-foreground">THE NIGHT’S LINEUP</p><h2 className="text-lg font-semibold">单局排行榜</h2></div></div><span className="shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] text-muted-foreground">第 {String(session.round).padStart(2, '0')} 局</span></div>
    <div className="mt-5 flex justify-between border-b pb-3 text-xs text-muted-foreground"><span>按已喝数量排序</span><span>{session.endedAt === undefined ? '实时更新' : '最终结果'}</span></div>
    <Ranking session={session} /><p className="border-t pt-4 text-xs leading-6 text-muted-foreground">全员统一杯量，按已喝数量排名。相同已喝数量并列排名。</p>
    <div className="mt-6 flex items-center gap-4 rounded-xl border border-primary/10 bg-accent/40 p-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-primary"><Martini aria-hidden="true" className="size-6" /></span><div><p className="text-sm font-medium">开心碰杯，量力而行。</p><p className="mt-1 text-xs text-muted-foreground">好朋友的局，尽兴就好</p></div></div>
  </Card>;
}
export function CloseButton({ close }: { close: () => void }) { return <Button type="button" variant="outline" onClick={close} data-testid="cancel-dialog">取消</Button>; }
