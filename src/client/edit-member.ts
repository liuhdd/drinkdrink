import { domainError } from '../shared/errors.ts';
import { validInteger } from '../shared/domain.ts';
import { rememberMembers, withLedgerSession } from '../shared/persistence.ts';
import type { EventIdentity, Ledger, LedgerEvent } from '../shared/types.ts';

// 编辑身份与计数时不修改输入账本。 Edit identity and counts without mutating the input ledger.
export function editMember(ledger: Ledger, id: string, nameInput: string, color: number, pendingInput: string, identity: EventIdentity): Ledger {
  if (ledger.session.endedAt !== undefined) throw domainError('本局已结束，请新开一局', 'edit member');
  const name = nameInput.trim();
  if (!name || name.length > 12) throw domainError('成员昵称必须为 1–12 个字', 'edit member');
  if (ledger.session.members.some(member => member.id !== id && member.name.toLowerCase() === name.toLowerCase())) throw domainError('已有同名成员，请使用不同昵称', 'edit member');
  if (ledger.knownMembers.some(member => member.id !== id && member.name.toLowerCase() === name.toLowerCase())) throw domainError('以前的酒友中已有此昵称，请使用不同昵称', 'edit member');
  const pending = validInteger(pendingInput, '待喝数量', 0, 9999);
  const old = ledger.session.members.find(member => member.id === id);
  if (!old) throw domainError('没有找到这位成员', 'edit member');
  const member = { ...old, name, color: validInteger(color, '头像颜色', 0, 5), pending };
  const event: LedgerEvent = { id: identity.id, memberId: id, name, color: member.color, action: 'set', amount: pending, at: identity.at };
  const session = { ...ledger.session, members: ledger.session.members.map(item => item.id === id ? member : item), events: pending === old.pending ? ledger.session.events : [event, ...ledger.session.events].slice(0, 80) };
  return withLedgerSession(ledger, session, { knownMembers: rememberMembers(ledger.knownMembers, [member]) });
}
