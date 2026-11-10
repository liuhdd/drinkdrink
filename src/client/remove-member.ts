import { domainError } from '../shared/errors.ts';
import { withLedgerSession } from '../shared/persistence.ts';
import type { Ledger, Member, Session } from '../shared/types.ts';

// 仅移除确认过的本局成员，冲突重试不能跨局或忽略新的计数。 Remove only the confirmed member from the same session; retries cannot ignore new counts or switch sessions.
export function removeMember(ledger: Ledger, session: Session, member: Member): Ledger {
  const current = ledger.session;
  if (current.startedAt !== session.startedAt || current.round !== session.round || current.demo !== session.demo) throw domainError('当前酒局已变更，请关闭窗口后重新选择酒友', 'remove member');
  if (current.endedAt !== undefined) throw domainError('本局已结束，不能删除酒友', 'remove member');
  const saved = current.members.find(item => item.id === member.id);
  if (!saved) throw domainError('这位酒友已不在本局，请关闭窗口', 'remove member');
  if (saved.name !== member.name || saved.color !== member.color || saved.pending !== member.pending || saved.consumed !== member.consumed || saved.cups !== member.cups || saved.cupSize !== member.cupSize) throw domainError('这位酒友的记录已更新，请关闭窗口后重新确认', 'remove member');
  return withLedgerSession(ledger, { ...current, members: current.members.filter(item => item.id !== member.id) }, {});
}
