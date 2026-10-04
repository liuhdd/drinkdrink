export const MAX_COUNT = 9999;

export function validInteger(value, label, min = 0, max = MAX_COUNT) {
  const number = Number(value);
  if (String(value).trim() === '' || !Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label}请输入 ${min}–${max} 之间的整数`);
  }
  return number;
}

export function createSession({ title = '今晚的酒局', cupSize = 2, members = [], round = 1, demo = false } = {}) {
  const sharedCupSize = validInteger(cupSize, '每杯数量', 1, 99);
  return {
    version: 1, title, cupSize: sharedCupSize, round,
    startedAt: Date.now(), demo,
    members: members.map(member => ({ ...member, cupSize: sharedCupSize, pending: 0, consumed: 0, cups: 0 })),
    events: [],
  };
}

// Keep the stored v1 member shape compatible while the round owns the cup size.
export function normalizeSessionCupSize(session) {
  return { ...session, members: session.members.map(member => ({ ...member, cupSize: session.cupSize })) };
}

export function addMembers(session, drafts, knownMembers = []) {
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
    const id = known?.id ?? crypto.randomUUID();
    ids.add(id);
    return {
      id, name, color: known?.color ?? (session.members.length + index) % 6,
      pending: validInteger(draft.pending ?? 0, `第 ${index + 1} 位成员待喝数量`),
      cupSize: session.cupSize, consumed: 0, cups: 0,
    };
  });
  const at = Date.now();
  const events = members.filter(member => member.pending > 0).map(member => ({
    id: crypto.randomUUID(), memberId: member.id, name: member.name, color: member.color,
    action: 'set', amount: member.pending, at,
  }));
  return normalizeSessionCupSize({ ...session, members: [...session.members, ...members], events: [...events.reverse(), ...session.events].slice(0, 80) });
}

export function memberAction(session, id, action, quantity = 1) {
  const member = session.members.find(item => item.id === id);
  if (!member) throw new Error('没有找到这位成员');
  let pending = member.pending;
  let consumed = member.consumed;
  let cups = member.cups;
  let amount;
  if (action === 'drink') {
    amount = session.cupSize;
    if (pending < amount) throw new Error(`待喝不足一杯（${amount} 个），请先加酒`);
    if (consumed + amount > MAX_COUNT) throw new Error('已喝数量已达到上限');
    pending -= amount;
    consumed += amount;
    cups += 1;
  } else if (action === 'add' || action === 'subtract') {
    amount = validInteger(quantity, '加减数量', 1, 99);
    if (action === 'subtract' && pending < amount) throw new Error('待喝数量不能小于 0');
    if (action === 'add' && pending + amount > MAX_COUNT) throw new Error('待喝数量已达到上限');
    pending += action === 'add' ? amount : -amount;
  } else {
    throw new Error('未知的记账操作');
  }
  return {
    ...session,
    members: session.members.map(item => item.id === id ? { ...item, pending, consumed, cups } : item),
    events: [{ id: crypto.randomUUID(), memberId: id, name: member.name, color: member.color, action, amount, at: Date.now() }, ...session.events].slice(0, 80),
  };
}

export function leaderboard(session) {
  const sorted = [...session.members].sort((a, b) => b.consumed - a.consumed || session.members.indexOf(a) - session.members.indexOf(b));
  return sorted.map((member, index) => ({
    ...member,
    rank: index > 0 && member.consumed === sorted[index - 1].consumed
      ? sorted.findIndex(item => item.consumed === member.consumed) + 1 : index + 1,
  }));
}

export function validateSession(value) {
  if (!value || value.version !== 1 || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 30 || !Array.isArray(value.members) || value.members.length > 30) return false;
  try {
    if (!Number.isInteger(value.cupSize) || !Number.isInteger(value.round)) return false;
    validInteger(value.cupSize, '每杯数量', 1, 99);
    validInteger(value.round, '局数', 1, Number.MAX_SAFE_INTEGER);
    if (!Number.isFinite(value.startedAt) || !Number.isFinite(new Date(value.startedAt).getTime()) || typeof value.demo !== 'boolean') return false;
    const ids = new Set();
    for (const member of value.members) {
      if (!member || typeof member.id !== 'string' || !member.id || ids.has(member.id) || typeof member.name !== 'string' || !member.name.trim() || member.name.length > 12) return false;
      ids.add(member.id);
      if (![member.cupSize, member.pending, member.consumed, member.cups].every(Number.isInteger)) return false;
      validInteger(member.cupSize, '杯量', 1, 99);
      validInteger(member.pending, '待喝');
      validInteger(member.consumed, '已喝');
      validInteger(member.cups, '杯数');
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

export function demoSession() {
  const session = createSession({ title: '周末小聚', demo: true });
  session.members = [
    { id: 'demo-1', name: '阿杰', color: 0, cupSize: 2, pending: 6, consumed: 8, cups: 4 },
    { id: 'demo-2', name: '小林', color: 1, cupSize: 2, pending: 4, consumed: 6, cups: 3 },
    { id: 'demo-3', name: '大白', color: 2, cupSize: 2, pending: 3, consumed: 4, cups: 2 },
    { id: 'demo-4', name: '思思', color: 3, cupSize: 2, pending: 2, consumed: 2, cups: 1 },
  ];
  return session;
}
