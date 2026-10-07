import type { Ledger, MemberSeen, RetainedLedger, StoredLedger } from '../shared/types.ts';
import { createSession, demoSession } from '../shared/domain.ts';
import { restoreLedger } from '../shared/persistence.ts';

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// 成员最后使用时间存于服务端，不属于浏览器可编辑的账本。 Member last-use timestamps live on the server, outside the browser-editable ledger.
export function retainLedger(value: Ledger, memberSeen: MemberSeen, now: number): RetainedLedger {
  const ledger = restoreLedger(value);
  const cutoff = now - RETENTION_MS;
  ledger.history = ledger.history.filter(entry => entry.endedAt >= cutoff).map(entry => ({
    ...entry, session: { ...entry.session, events: entry.session.events.filter(event => event.at >= cutoff) },
  }));
  if ((ledger.session.endedAt ?? ledger.session.startedAt) < cutoff) ledger.session = ledger.session.demo ? demoSession() : createSession({ title: '今晚的酒局', cupSize: 2, members: [], round: 1, demo: false });
  ledger.session = { ...ledger.session, events: ledger.session.events.filter(event => event.at >= cutoff) };
  const seen = Object.fromEntries(ledger.knownMembers.map<[string, number]>(member => { const seenAt = Object.hasOwn(memberSeen, member.id) ? memberSeen[member.id] : now; if (typeof seenAt !== 'number') throw new TypeError('成员时间格式无效'); return [member.id, seenAt]; }).filter(([, at]) => at >= cutoff));
  ledger.knownMembers = ledger.knownMembers.filter(member => Object.hasOwn(seen, member.id));
  const dates = [now, ...Object.values(seen), ...ledger.history.map(entry => entry.endedAt),
    ...ledger.history.flatMap(entry => entry.session.events.map(event => event.at)), ...ledger.session.events.map(event => event.at)];
  dates.push(ledger.session.endedAt ?? ledger.session.startedAt);
  return { ledger, memberSeen: seen, cleanupAt: Math.min(...dates) + RETENTION_MS };
}

export function prepareLedger(value: Ledger, previous: StoredLedger | null, now: number): RetainedLedger {
  const ledger = restoreLedger(value);
  const seen: MemberSeen = { ...previous?.memberSeen };
  for (const profile of ledger.knownMembers) {
    const oldProfile = previous?.ledger.knownMembers.find(member => member.id === profile.id);
    const member = ledger.session.members.find(member => member.id === profile.id);
    const oldMember = previous?.ledger.session.members.find(member => member.id === profile.id);
    if (!Object.hasOwn(seen, profile.id) || JSON.stringify(profile) !== JSON.stringify(oldProfile)
      || (member && (ledger.session.startedAt !== previous?.ledger.session.startedAt || JSON.stringify(member) !== JSON.stringify(oldMember)))) Object.defineProperty(seen, profile.id, { value: now, enumerable: true, configurable: true, writable: true });
  }
  return retainLedger(ledger, seen, now);
}
