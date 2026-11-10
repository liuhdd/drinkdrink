import { domainError } from '../shared/errors.ts';
import { validInteger } from '../shared/domain.ts';
import { rememberMembers, withLedgerSession } from '../shared/persistence.ts';
import { unchangedMember } from './member-source.ts';
import type { EventIdentity, Ledger, LedgerEvent, Member, Session } from '../shared/types.ts';

// 编辑身份与计数时不修改输入账本。 Edit identity and counts without mutating the input ledger.
export function editMember(ledger: Ledger, source: { session: Session; member: Member }, nameInput: string, color: number, pendingInput: string, identity: EventIdentity): Ledger {
  const old = unchangedMember(ledger.session, source.session, source.member);
  const id = old.id;
  const name = nameInput.trim();
  if (!name || name.length > 12) throw domainError('成员昵称必须为 1–12 个字', 'edit member');
  if (ledger.session.members.some(member => member.id !== id && member.name.toLowerCase() === name.toLowerCase())) throw domainError('已有同名成员，请使用不同昵称', 'edit member');
  if (ledger.knownMembers.some(member => member.id !== id && member.name.toLowerCase() === name.toLowerCase())) throw domainError('以前的酒友中已有此昵称，请使用不同昵称', 'edit member');
  const pending = validInteger(pendingInput, '待喝数量', 0, 9999);
  const member = { ...old, name, color: validInteger(color, '头像颜色', 0, 5), pending };
  const event: LedgerEvent = { id: identity.id, memberId: id, name, color: member.color, action: 'set', amount: pending, at: identity.at };
  const session = { ...ledger.session, members: ledger.session.members.map(item => item.id === id ? member : item), events: pending === old.pending ? ledger.session.events : [event, ...ledger.session.events].slice(0, 80) };
  return withLedgerSession(ledger, session, { knownMembers: rememberMembers(ledger.knownMembers, [member]) });
}
