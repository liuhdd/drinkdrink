import type { ExternalValue, Session, Member, Profile, LedgerEvent, SaveRequest } from './types.ts';
import { field, list } from './values.ts';

export function invalid(path: string, expected: string, value: ExternalValue): never {
  throw new TypeError(`记录 ${path} 必须是${expected}，收到 ${String(value)}`);
}
export function objectInput(value: ExternalValue, path: string): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, '对象', value);
  return value;
}
export function required(value: ExternalValue, key: string, path: string): ExternalValue {
  const record = objectInput(value, path);
  if (!Object.hasOwn(record, key)) invalid(`${path}.${key}`, '必填字段', undefined);
  return field(record, key);
}
export function textInput(value: ExternalValue, path: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(path, `非空字符串（最多 ${max} 个字）`, value);
  return value;
}
export function integerInput(value: ExternalValue, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(path, `${min}–${max} 范围内的整数`, value);
  return value;
}
export function timestampInput(value: ExternalValue, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) invalid(path, '有效时间戳', value);
  return value;
}
export function profileInput(value: ExternalValue, path: string): Profile {
  return { id: textInput(required(value, 'id', path), `${path}.id`, Number.MAX_SAFE_INTEGER), name: textInput(required(value, 'name', path), `${path}.name`, 12), color: integerInput(required(value, 'color', path), `${path}.color`, 0, 5) };
}
function memberInput(value: ExternalValue, path: string): Member {
  return { ...profileInput(value, path), cupSize: integerInput(required(value, 'cupSize', path), `${path}.cupSize`, 1, 99), pending: integerInput(required(value, 'pending', path), `${path}.pending`, 0, 9999), consumed: integerInput(required(value, 'consumed', path), `${path}.consumed`, 0, 9999), cups: integerInput(required(value, 'cups', path), `${path}.cups`, 0, 9999) };
}
function eventInput(value: ExternalValue, path: string): LedgerEvent {
  const action = required(value, 'action', path);
  if (action !== 'add' && action !== 'subtract' && action !== 'drink' && action !== 'set') invalid(`${path}.action`, '有效操作名', action);
  return { ...profileInput(value, path), memberId: textInput(required(value, 'memberId', path), `${path}.memberId`, Number.MAX_SAFE_INTEGER), action, amount: integerInput(required(value, 'amount', path), `${path}.amount`, action === 'set' ? 0 : 1, action === 'set' ? 9999 : 99), at: timestampInput(required(value, 'at', path), `${path}.at`) };
}
export function sessionInput(value: ExternalValue, path: string): Session {
  const version = required(value, 'version', path), demo = required(value, 'demo', path);
  if (version !== 1) invalid(`${path}.version`, '版本 1', version);
  if (typeof demo !== 'boolean') invalid(`${path}.demo`, '布尔值', demo);
  const members = list(required(value, 'members', path)).map((member, index) => memberInput(member, `${path}.members[${index}]`));
  const events = list(required(value, 'events', path)).map((event, index) => eventInput(event, `${path}.events[${index}]`));
  if (members.length > 30 || events.length > 80) invalid(path, '最多 30 位成员、80 条操作', value);
  if (new Set(members.map(member => member.id)).size !== members.length) invalid(`${path}.members`, '不重复的成员 ID', value);
  const startedAt = timestampInput(required(value, 'startedAt', path), `${path}.startedAt`);
  const rawEnd = field(value, 'endedAt');
  const endedAt = rawEnd === undefined ? undefined : timestampInput(rawEnd, `${path}.endedAt`);
  if (endedAt !== undefined && (demo || endedAt < startedAt)) invalid(`${path}.endedAt`, '正式酒局开始后的时间', endedAt);
  return { version: 1, title: textInput(required(value, 'title', path), `${path}.title`, 30), cupSize: integerInput(required(value, 'cupSize', path), `${path}.cupSize`, 1, 99), round: integerInput(required(value, 'round', path), `${path}.round`, 1, Number.MAX_SAFE_INTEGER), startedAt, demo, members, events, ...(endedAt === undefined ? {} : { endedAt }) };
}
export interface MemberActionInput { memberId: string; action: 'add' | 'subtract' | 'drink'; quantity: number; }
export function memberActionInput(value: ExternalValue, step: number): MemberActionInput {
  const memberId = textInput(required(value, 'memberId', 'action'), 'action.memberId', Number.MAX_SAFE_INTEGER);
  const action = required(value, 'action', 'action');
  if (action !== 'add' && action !== 'subtract' && action !== 'drink') invalid('action.action', '加酒、减酒或喝完操作', action);
  const rawQuantity = field(value, 'quantity');
  const quantity = rawQuantity === undefined ? step : integerInput(rawQuantity, 'action.quantity', 1, 99);
  return { memberId, action, quantity };
}
