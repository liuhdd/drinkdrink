import { domainError } from '../shared/errors.ts';
import { withLedgerSession } from '../shared/persistence.ts';
import type { Ledger, Session } from '../shared/types.ts';

// 撤销不能让两个已保存身份共用昵称，也不能删除其他酒友的档案。 Undo must not give saved identities the same nickname or delete another friend's profile.
export function restoreMemberSnapshot(ledger: Ledger, session: Session): Ledger {
  for (const member of session.members) {
    const conflict = ledger.knownMembers.some(profile => profile.id !== member.id && profile.name.trim().toLowerCase() === member.name.trim().toLowerCase());
    if (conflict) throw domainError(`无法撤销：昵称「${member.name}」已被另一位已保存酒友使用，请在成员编辑中手动调整`, 'undo member');
  }
  return withLedgerSession(ledger, session, {});
}
