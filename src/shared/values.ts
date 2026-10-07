import type { ExternalValue, Profile, Member, LedgerEvent, Session, Snapshot, DatabaseRow, StoredLedger, MemberSeen } from './types.ts';

// 未验证的外部值仅在解析边界读取。 Read unvalidated external values only at the parsing boundary.
export function field(value: ExternalValue, key: string): ExternalValue {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined;
}
export function list(value: ExternalValue): ExternalValue[] {
  if (!Array.isArray(value)) throw new TypeError('记录集合格式无效');
  return value;
}
export function isProfile(value: ExternalValue): value is Profile {
  return typeof field(value, 'id') === 'string' && typeof field(value, 'name') === 'string' && typeof field(value, 'color') === 'number';
}
export function isMember(value: ExternalValue): value is Member {
  return isProfile(value) && ['cupSize', 'pending', 'consumed', 'cups'].every(key => typeof field(value, key) === 'number');
}
export function isEvent(value: ExternalValue): value is LedgerEvent {
  return isProfile(value) && typeof field(value, 'memberId') === 'string' && typeof field(value, 'action') === 'string' && ['add', 'subtract', 'drink', 'set'].includes(String(field(value, 'action'))) && typeof field(value, 'amount') === 'number' && typeof field(value, 'at') === 'number';
}
export function isSessionShape(value: ExternalValue): value is Session {
  const members = field(value, 'members'), events = field(value, 'events');
  return field(value, 'version') === 1 && typeof field(value, 'title') === 'string' && ['cupSize', 'round', 'startedAt'].every(key => typeof field(value, key) === 'number') && typeof field(value, 'demo') === 'boolean' && Array.isArray(members) && members.every(isMember) && Array.isArray(events) && events.every(isEvent) && (field(value, 'endedAt') === undefined || typeof field(value, 'endedAt') === 'number');
}
export function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`集合索引 ${index} 不存在`);
  return value;
}
export function errorSnapshot(error: Error): Snapshot | null {
  const value = field(error, 'data');
  const ledger = field(value, 'ledger'), revision = field(value, 'revision'), generation = field(value, 'generation');
  if (typeof revision !== 'number' || (generation !== null && typeof generation !== 'string') || (ledger !== null && !isSessionShape(field(ledger, 'session')))) return null;
  if (ledger !== null && !isLedgerShape(ledger)) return null;
  return { ledger, revision, generation };
}
export function isLedgerShape(value: ExternalValue): value is import('./types.ts').Ledger {
  return field(value, 'version') === 2 && isSessionShape(field(value, 'session')) && typeof field(value, 'step') === 'number' && Array.isArray(field(value, 'history')) && list(field(value, 'history')).every(entry => typeof field(entry, 'id') === 'string' && typeof field(entry, 'endedAt') === 'number' && isSessionShape(field(entry, 'session'))) && Array.isArray(field(value, 'knownMembers')) && list(field(value, 'knownMembers')).every(isProfile);
}
export function databaseRow(value: ExternalValue): DatabaseRow {
  const device_id = field(value, 'device_id'), data = field(value, 'data'), revision = field(value, 'revision'), generation = field(value, 'generation'), updated_at = field(value, 'updated_at'), cleanup_at = field(value, 'cleanup_at');
  if (typeof device_id !== 'string' || typeof data !== 'string' || typeof revision !== 'number' || typeof generation !== 'string' || typeof updated_at !== 'number' || typeof cleanup_at !== 'number') throw new TypeError('数据库记录格式无效');
  return { device_id, data, revision, generation, updated_at, cleanup_at };
}
export function memberSeen(value: ExternalValue): MemberSeen {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('成员时间格式无效');
  return Object.fromEntries(Object.keys(value).map(key => {
    const at = field(value, key);
    if (typeof at !== 'number') throw new TypeError('成员时间格式无效');
    return [key, at];
  }));
}
export function storedLedger(value: ExternalValue, restore: (value: ExternalValue) => import('./types.ts').Ledger): StoredLedger {
  return { ledger: restore(field(value, 'ledger')), memberSeen: memberSeen(field(value, 'memberSeen')) };
}
export function requireLedger(value: Snapshot): import('./types.ts').Ledger {
  if (value.ledger === null) throw new TypeError('服务端没有返回已保存的账本');
  return value.ledger;
}
