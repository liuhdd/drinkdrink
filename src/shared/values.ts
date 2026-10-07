import { validationError } from './errors.ts';
import type { ExternalValue, Profile, Member, LedgerEvent, Session, Snapshot, DatabaseRow, StoredLedger, MemberSeen } from './types.ts';

// 未验证的外部值仅在解析边界读取。 Read unvalidated external values only at the parsing boundary.
export function field(value: ExternalValue, key: string): ExternalValue {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined;
}
export function list(value: ExternalValue): ExternalValue[] {
  if (!Array.isArray(value)) throw validationError('collection', '集合', value);
  return value;
}
export function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`集合索引 ${index} 不存在`);
  return value;
}
export function requireLedger(value: Snapshot): import('./types.ts').Ledger {
  if (value.ledger === null) throw new TypeError('服务端没有返回已保存的账本');
  return value.ledger;
}
