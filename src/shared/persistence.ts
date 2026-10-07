import type { ExternalValue, Profile, Member, Ledger, NextOptions, Archive } from './types.ts';
import { field, list, isProfile } from './values.ts';
import { createSession, demoSession, normalizeSessionCupSize, validateSession, validInteger } from './domain.ts';

const nameKey = (name: string): string => name.trim().toLowerCase();

export function rememberMembers(knownMembers: readonly Profile[], members: readonly Profile[]): Profile[] {
  let next = [...knownMembers];
  for (const member of members) {
    const profile = { id: member.id, name: member.name, color: member.color };
    next = [profile, ...next.filter(item => item.id !== profile.id)];
  }
  return next;
}

export function availableMembers(knownMembers: readonly Profile[], session: import('./types.ts').Session): Profile[] {
  const ids = new Set(session.members.map(member => member.id));
  const names = new Set(session.members.map(member => nameKey(member.name)));
  return knownMembers.filter(member => !ids.has(member.id) && !names.has(nameKey(member.name)));
}

export function emptyLedger(startedAt: number): Ledger {
  return { version: 2, session: demoSession(startedAt), step: 1, history: [], knownMembers: [] };
}

export function restoreLedger(value: ExternalValue): Ledger {
  const version = field(value, 'version'), rawSession = field(value, 'session');
  if (!value || (version !== undefined && version !== 2) || !validateSession(rawSession)) throw new Error('酒局记录格式无效');
  const session = normalizeSessionCupSize(rawSession);
  const step = validInteger(field(value, 'step') ?? 1, '快捷加减数量', 1, 99);
  if (version === undefined) {
    const members = session.demo ? session.members.filter(member => !/^demo-[1-4]$/.test(member.id)) : session.members;
    return { version: 2, session, step, history: [], knownMembers: rememberMembers([], members) };
  }
  if (!Array.isArray(field(value, 'history')) || !Array.isArray(field(value, 'knownMembers'))) throw new Error('历史记录格式无效');
  const archiveIds = new Set<string>();
  const history: Archive[] = list(field(value, 'history')).map(entry => {
    const id = field(entry, 'id'), endedAt = field(entry, 'endedAt'), archived = field(entry, 'session');
    if (typeof id !== 'string' || !id || archiveIds.has(id) || typeof endedAt !== 'number' || !Number.isFinite(endedAt) || !Number.isFinite(new Date(endedAt).getTime()) || !validateSession(archived) || archived.demo || endedAt < archived.startedAt) throw new Error('历史酒局格式无效');
    archiveIds.add(id);
    if (archived.endedAt !== undefined && archived.endedAt !== endedAt) throw new Error('历史酒局结束时间不一致');
    return { id, endedAt, session: normalizeSessionCupSize(archived) };
  });
  const ids = new Set<string>();
  const knownMembers = list(field(value, 'knownMembers')).map(member => {
    if (!isProfile(member) || !member.id || ids.has(member.id) || !member.name.trim() || member.name.length > 12 || !Number.isInteger(member.color) || member.color < 0 || member.color > 5) throw new Error('已保存成员格式无效');
    ids.add(member.id);
    return { id: member.id, name: member.name.trim(), color: member.color };
  });
  return { version: 2, session, step, history, knownMembers };
}

export function finishSession(ledger: Ledger, endedAt: number | string, archiveId: string): Ledger {
  if (ledger.session.demo) throw new Error('体验酒局不归档，请先新开一局');
  if (ledger.session.endedAt !== undefined) throw new Error('本局已结束');
  if (typeof endedAt !== 'number' || !Number.isFinite(endedAt) || !Number.isFinite(new Date(endedAt).getTime()) || endedAt < ledger.session.startedAt) throw new Error('结束时间无效');
  const session = { ...structuredClone(ledger.session), endedAt };
  return {
    ...ledger, session,
    knownMembers: rememberMembers(ledger.knownMembers, session.members),
    history: [{ id: archiveId, endedAt, session: structuredClone(session) }, ...ledger.history],
  };
}

export function startNextSession(ledger: Ledger, { title, cupSize, members }: NextOptions, endedAt: number, archiveId: string): Ledger {
  const session = createSession({ title, cupSize, members, round: ledger.session.demo ? 1 : ledger.session.round + 1 }, endedAt);
  return {
    ...ledger, session,
    knownMembers: ledger.session.demo ? ledger.knownMembers : rememberMembers(ledger.knownMembers, ledger.session.members),
    history: ledger.session.demo || ledger.session.endedAt !== undefined ? ledger.history : [{ id: archiveId, endedAt: Math.max(endedAt, ledger.session.startedAt), session: structuredClone(ledger.session) }, ...ledger.history],
  };
}
export function withLedgerSession(ledger: Ledger, session: import('./types.ts').Session, changes: Partial<Ledger>): Ledger {
  return { ...ledger, ...changes, session, knownMembers: rememberMembers(changes.knownMembers ?? ledger.knownMembers, session.demo ? [] : session.members) };
}
