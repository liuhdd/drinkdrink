import { createSession, demoSession, normalizeSessionCupSize, validateSession, validInteger } from './domain.mjs';

const nameKey = name => name.trim().toLowerCase();

export function rememberMembers(knownMembers, members) {
  let next = [...knownMembers];
  for (const member of members) {
    const profile = { id: member.id, name: member.name, color: member.color };
    next = [profile, ...next.filter(item => item.id !== profile.id)];
  }
  return next;
}

export function availableMembers(knownMembers, session) {
  const ids = new Set(session.members.map(member => member.id));
  const names = new Set(session.members.map(member => nameKey(member.name)));
  return knownMembers.filter(member => !ids.has(member.id) && !names.has(nameKey(member.name)));
}

export function emptyLedger() {
  return { version: 2, session: demoSession(), step: 1, history: [], knownMembers: [] };
}

export function restoreLedger(value) {
  if (!value || (value.version !== undefined && value.version !== 2) || !validateSession(value.session)) throw new Error('酒局记录格式无效');
  const session = normalizeSessionCupSize(value.session);
  const step = validInteger(value.step ?? 1, '快捷加减数量', 1, 99);
  if (value.version === undefined) {
    const members = session.demo ? session.members.filter(member => !/^demo-[1-4]$/.test(member.id)) : session.members;
    return { version: 2, session, step, history: [], knownMembers: rememberMembers([], members) };
  }
  if (!Array.isArray(value.history) || !Array.isArray(value.knownMembers)) throw new Error('历史记录格式无效');
  const archiveIds = new Set();
  const history = value.history.map(entry => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || archiveIds.has(entry.id) || !Number.isFinite(entry.endedAt) || !Number.isFinite(new Date(entry.endedAt).getTime()) || !validateSession(entry.session) || entry.session.demo || entry.endedAt < entry.session.startedAt) throw new Error('历史酒局格式无效');
    archiveIds.add(entry.id);
    if (entry.session.endedAt !== undefined && entry.session.endedAt !== entry.endedAt) throw new Error('历史酒局结束时间不一致');
    return { id: entry.id, endedAt: entry.endedAt, session: normalizeSessionCupSize(entry.session) };
  });
  const ids = new Set();
  const knownMembers = value.knownMembers.map(member => {
    if (!member || typeof member.id !== 'string' || !member.id || ids.has(member.id) || typeof member.name !== 'string' || !member.name.trim() || member.name.length > 12 || !Number.isInteger(member.color) || member.color < 0 || member.color > 5) throw new Error('已保存成员格式无效');
    ids.add(member.id);
    return { id: member.id, name: member.name.trim(), color: member.color };
  });
  return { version: 2, session, step, history, knownMembers };
}

export function finishSession(ledger, endedAt = Date.now()) {
  if (ledger.session.demo) throw new Error('体验酒局不归档，请先新开一局');
  if (ledger.session.endedAt !== undefined) throw new Error('本局已结束');
  if (!Number.isFinite(endedAt) || !Number.isFinite(new Date(endedAt).getTime()) || endedAt < ledger.session.startedAt) throw new Error('结束时间无效');
  const session = { ...structuredClone(ledger.session), endedAt };
  return {
    ...ledger, session,
    knownMembers: rememberMembers(ledger.knownMembers, session.members),
    history: [{ id: crypto.randomUUID(), endedAt, session: structuredClone(session) }, ...ledger.history],
  };
}

export function startNextSession(ledger, { title, cupSize, keepMembers = false }, endedAt = Date.now()) {
  const session = createSession({ title, cupSize, members: keepMembers ? ledger.session.members : [], round: ledger.session.demo ? 1 : ledger.session.round + 1 });
  return {
    ...ledger, session,
    knownMembers: ledger.session.demo ? ledger.knownMembers : rememberMembers(ledger.knownMembers, ledger.session.members),
    history: ledger.session.demo || ledger.session.endedAt !== undefined ? ledger.history : [{ id: crypto.randomUUID(), endedAt: Math.max(endedAt, ledger.session.startedAt), session: structuredClone(ledger.session) }, ...ledger.history],
  };
}
