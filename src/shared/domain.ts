import type { ExternalValue, Session, SessionOptions, Profile, Draft, LedgerEvent, RankedMember, Member, EventIdentity, DraftIdentity } from './types.ts';
import { at, isSessionShape } from './values.ts';
export const MAX_COUNT = 9999;

export function validInteger(value: ExternalValue, label: string, min: number, max: number): number {
  const number = Number(value);
  if (String(value).trim() === '' || !Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label}请输入 ${min}–${max} 之间的整数`);
  }
  return number;
}

export function createSession({ title, cupSize, members, round }: SessionOptions, startedAt: number): Session {
  const sharedCupSize = validInteger(cupSize, '每杯数量', 1, 99);
  return {
    version: 1, title, cupSize: sharedCupSize, round,
    startedAt, demo: false,
    members: members.map(member => ({ ...member, cupSize: sharedCupSize, pending: 0, consumed: 0, cups: 0 })),
    events: [],
  };
}

// 杯量由酒局统一管理，保留 v1 成员结构兼容性。 Keep the stored v1 member shape compatible while the round owns the cup size.
export function normalizeSessionCupSize(session: Session): Session {
  return { ...session, members: session.members.map(member => ({ ...member, cupSize: session.cupSize })) };
}

export function addMembers(session: Session, drafts: readonly Draft[], knownMembers: readonly Profile[], identity: DraftIdentity): Session {
  if (session.endedAt !== undefined) throw new Error('本局已结束，请新开一局');
  if (!Array.isArray(drafts) || drafts.length === 0) throw new Error('请至少添加一位酒友');
  if (session.members.length + drafts.length > 30) throw new Error('一局最多添加 30 位成员');
  const names = new Set(session.members.map(member => member.name.toLowerCase()));
  const ids = new Set(session.members.map(member => member.id));
  const members = drafts.map((draft, index) => {
    const typedName = typeof draft?.name === 'string' ? draft.name.trim() : '';
    const known = draft?.knownMemberId
      ? knownMembers.find(member => member.id === draft.knownMemberId)
      : knownMembers.find(member => member.name.toLowerCase() === typedName.toLowerCase());
    if (draft?.knownMemberId && !known) throw new Error('没有找到这位已保存成员，请重新选择');
    const name = known?.name ?? typedName;
    if (!name) throw new Error(`请输入第 ${index + 1} 位成员的昵称`);
    if (name.length > 12) throw new Error(`第 ${index + 1} 位成员昵称最多 12 个字`);
    if (names.has(name.toLowerCase()) || (known && ids.has(known.id))) throw new Error(`「${name}」成员重复，请选择其他酒友`);
    names.add(name.toLowerCase());
    const id = known?.id ?? at(identity.memberIds, index);
    ids.add(id);
    return {
      id, name, color: known?.color ?? (session.members.length + index) % 6,
      pending: validInteger(draft.pending ?? 0, `第 ${index + 1} 位成员待喝数量`, 0, 9999),
      cupSize: session.cupSize, consumed: 0, cups: 0,
    };
  });
  const happenedAt = identity.at;
  const events: LedgerEvent[] = members.filter(member => member.pending > 0).map((member, index) => ({
    id: at(identity.eventIds, index), memberId: member.id, name: member.name, color: member.color,
    action: 'set', amount: member.pending, at: happenedAt,
  }));
  return normalizeSessionCupSize({ ...session, members: [...session.members, ...members], events: [...events.reverse(), ...session.events].slice(0, 80) });
}

function activeMember(session: Session, id: string): Member {
  if (session.endedAt !== undefined) throw new Error('本局已结束，请新开一局');
  const member = session.members.find(item => item.id === id);
  if (!member) throw new Error('没有找到这位成员');
  return member;
}
function recordMember(session: Session, member: Member, event: LedgerEvent): Session {
  return { ...session, members: session.members.map(item => item.id === member.id ? member : item), events: [event, ...session.events].slice(0, 80) };
}
export function addPending(session: Session, id: string, quantity: number | string, identity: EventIdentity): Session {
  const member = activeMember(session, id);
  const amount = validInteger(quantity, '加减数量', 1, 99);
  if (member.pending + amount > MAX_COUNT) throw new Error('待喝数量已达到上限');
  return recordMember(session, { ...member, pending: member.pending + amount }, { id: identity.id, memberId: id, name: member.name, color: member.color, action: 'add', amount, at: identity.at });
}
export function subtractPending(session: Session, id: string, quantity: number | string, identity: EventIdentity): Session {
  const member = activeMember(session, id);
  const amount = validInteger(quantity, '加减数量', 1, 99);
  if (member.pending < amount) throw new Error('待喝数量不能小于 0');
  return recordMember(session, { ...member, pending: member.pending - amount }, { id: identity.id, memberId: id, name: member.name, color: member.color, action: 'subtract', amount, at: identity.at });
}
export function completeCup(session: Session, id: string, identity: EventIdentity): Session {
  const member = activeMember(session, id);
  const amount = session.cupSize;
  if (member.pending < amount) throw new Error(`待喝不足一杯（${amount} 个），请先加酒`);
  if (member.consumed + amount > MAX_COUNT) throw new Error('已喝数量已达到上限');
  return recordMember(session, { ...member, pending: member.pending - amount, consumed: member.consumed + amount, cups: member.cups + 1 }, { id: identity.id, memberId: id, name: member.name, color: member.color, action: 'drink', amount, at: identity.at });
}

export function leaderboard(session: Session): RankedMember[] {
  const sorted = [...session.members].sort((a, b) => b.consumed - a.consumed || session.members.indexOf(a) - session.members.indexOf(b));
  return sorted.map((member, index) => ({
    ...member,
    rank: index > 0 && member.consumed === at(sorted, index - 1).consumed
      ? sorted.findIndex(item => item.consumed === member.consumed) + 1 : index + 1,
  }));
}

export function validateSession(value: ExternalValue): value is Session {
  if (!isSessionShape(value) || value.version !== 1 || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 30 || !Array.isArray(value.members) || value.members.length > 30) return false;
  try {
    if (!Number.isInteger(value.cupSize) || !Number.isInteger(value.round)) return false;
    validInteger(value.cupSize, '每杯数量', 1, 99);
    validInteger(value.round, '局数', 1, Number.MAX_SAFE_INTEGER);
    if (!Number.isFinite(value.startedAt) || !Number.isFinite(new Date(value.startedAt).getTime()) || typeof value.demo !== 'boolean') return false;
    if (value.endedAt !== undefined && (value.demo || !Number.isFinite(value.endedAt) || !Number.isFinite(new Date(value.endedAt).getTime()) || value.endedAt < value.startedAt)) return false;
    const ids = new Set();
    for (const member of value.members) {
      if (!member || typeof member.id !== 'string' || !member.id || ids.has(member.id) || typeof member.name !== 'string' || !member.name.trim() || member.name.length > 12) return false;
      ids.add(member.id);
      if (![member.cupSize, member.pending, member.consumed, member.cups].every(Number.isInteger)) return false;
      validInteger(member.cupSize, '杯量', 1, 99);
      validInteger(member.pending, '待喝', 0, 9999);
      validInteger(member.consumed, '已喝', 0, 9999);
      validInteger(member.cups, '杯数', 0, 9999);
      if (!Number.isInteger(member.color) || member.color < 0 || member.color > 5) return false;
    }
    if (!Array.isArray(value.events) || value.events.length > 80) return false;
    for (const event of value.events) {
      if (!event || typeof event.id !== 'string' || !event.id || typeof event.memberId !== 'string' || typeof event.name !== 'string' || !event.name.trim() || event.name.length > 12 || !Number.isInteger(event.color) || event.color < 0 || event.color > 5 || !['add', 'subtract', 'drink', 'set'].includes(event.action) || !Number.isFinite(event.at) || !Number.isFinite(new Date(event.at).getTime()) || !Number.isInteger(event.amount)) return false;
      validInteger(event.amount, '数量', event.action === 'set' ? 0 : 1, event.action === 'set' ? MAX_COUNT : 99);
    }
    return true;
  } catch { return false; }
}

export function demoSession(startedAt: number): Session {
  const session = createSession({ title: '周末小聚', cupSize: 2, members: [], round: 1 }, startedAt);
  return { ...session, demo: true, members: [
    { id: 'demo-1', name: '阿杰', color: 0, cupSize: 2, pending: 6, consumed: 8, cups: 4 },
    { id: 'demo-2', name: '小林', color: 1, cupSize: 2, pending: 4, consumed: 6, cups: 3 },
    { id: 'demo-3', name: '大白', color: 2, cupSize: 2, pending: 3, consumed: 4, cups: 2 },
    { id: 'demo-4', name: '思思', color: 3, cupSize: 2, pending: 2, consumed: 2, cups: 1 },
  ] };
}
