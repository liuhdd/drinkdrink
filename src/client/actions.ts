import { domainError } from '../shared/errors.ts';
import { addPending, subtractPending, completeCup } from '../shared/domain.ts';
import type { Session, EventIdentity, DraftIdentity } from '../shared/types.ts';

// 将页面和 WebMCP 的操作名路由至单一用途业务函数。 Route UI and WebMCP action names to single-purpose domain functions.
export function recordAction(session: Session, id: string, action: string, quantity: number | string, identity: EventIdentity): Session {
  if (action === 'add') return addPending(session, id, quantity, identity);
  if (action === 'subtract') return subtractPending(session, id, quantity, identity);
  if (action === 'drink') return completeCup(session, id, identity);
  throw domainError('未知的记账操作', 'actions');
}
export function draftIdentity(count: number): DraftIdentity {
  return { memberIds: Array.from({ length: count }, () => crypto.randomUUID()), eventIds: Array.from({ length: count }, () => crypto.randomUUID()), at: Date.now() };
}
