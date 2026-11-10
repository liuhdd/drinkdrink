import { unchangedMember } from './member-source.ts';
import { withLedgerSession } from '../shared/persistence.ts';
import type { Ledger, Member, Session } from '../shared/types.ts';

// 仅移除确认过的本局成员，冲突重试不能跨局或忽略新的计数。 Remove only the confirmed member from the same session; retries cannot ignore new counts or switch sessions.
export function removeMember(ledger: Ledger, session: Session, member: Member): Ledger {
  const current = ledger.session;
  unchangedMember(current, session, member);
  return withLedgerSession(ledger, { ...current, members: current.members.filter(item => item.id !== member.id) }, {});
}
