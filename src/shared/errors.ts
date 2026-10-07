import type { ExternalValue, SqlParameter } from './types.ts';

export type ProblemCode = 'VALIDATION' | 'DOMAIN_RULE' | 'NETWORK' | 'HTTP' | 'RESPONSE' | 'CONFLICT' | 'STORAGE' | 'CORRUPT_STORAGE' | 'BROWSER' | 'INTERNAL';
export interface RequestDetails { method: string; url: string; body: string | null; deviceId: string | null; requestId: string | null; }
export interface DatabaseDetails { sql: string; parameters: readonly SqlParameter[]; }
export interface ProblemDetails { operation: string; path: string | null; request: RequestDetails | null; database: DatabaseDetails | null; status: number | null; responseBody: string | null; }
export type Problem = Error & { code: ProblemCode; details: ProblemDetails };
export interface ErrorBody { error: string; code: ProblemCode; details: ProblemDetails; cause: { name: string; message: string } | null; }

export function context(operation: string, path: string | null): ProblemDetails {
  return { operation, path, request: null, database: null, status: null, responseBody: null };
}
export function problem(code: ProblemCode, message: string, details: ProblemDetails, cause: Error | undefined): Problem {
  return Object.assign(new Error(message, { cause }), { name: `${code}Error`, code, details });
}
export function validationError(path: string, expected: string, received: ExternalValue): Problem {
  const code: ProblemCode = 'VALIDATION';
  return Object.assign(new TypeError(`记录格式无效：${path} 必须是${expected}，收到 ${String(received)}`), { name: 'ValidationError', code, details: context('validate data', path) });
}
export function domainError(message: string, operation: string): Problem {
  return problem('DOMAIN_RULE', message, context(operation, null), undefined);
}
export function parseJson(text: string, operation: string): ExternalValue {
  try { return JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw problem('VALIDATION', `JSON 格式无效：${error.message}`, { ...context(operation, null), responseBody: text }, error);
  }
}
function isRequest(value: ExternalValue): value is RequestDetails {
  if (value === null || typeof value !== 'object') return false;
  return typeof Reflect.get(value, 'method') === 'string' && typeof Reflect.get(value, 'url') === 'string' && (Reflect.get(value, 'body') === null || typeof Reflect.get(value, 'body') === 'string') && (Reflect.get(value, 'requestId') === null || typeof Reflect.get(value, 'requestId') === 'string') && (Reflect.get(value, 'deviceId') === null || typeof Reflect.get(value, 'deviceId') === 'string');
}
function isDetails(value: ExternalValue): value is ProblemDetails {
  if (value === null || typeof value !== 'object') return false;
  const path: ExternalValue = Reflect.get(value, 'path'), request: ExternalValue = Reflect.get(value, 'request'), database: ExternalValue = Reflect.get(value, 'database'), status: ExternalValue = Reflect.get(value, 'status'), body: ExternalValue = Reflect.get(value, 'responseBody');
  const isDatabase = database !== null && typeof database === 'object' && typeof Reflect.get(database, 'sql') === 'string' && Array.isArray(Reflect.get(database, 'parameters')) && Array.from<ExternalValue>(Reflect.get(database, 'parameters')).every(item => item === null || typeof item === 'string' || typeof item === 'number');
  return typeof Reflect.get(value, 'operation') === 'string' && (path === null || typeof path === 'string') && (request === null || isRequest(request)) && (database === null || isDatabase) && (status === null || typeof status === 'number') && (body === null || typeof body === 'string');
}
export function isProblemCode(value: ExternalValue): value is ProblemCode {
  return typeof value === 'string' && ['VALIDATION', 'DOMAIN_RULE', 'NETWORK', 'HTTP', 'RESPONSE', 'CONFLICT', 'STORAGE', 'CORRUPT_STORAGE', 'BROWSER', 'INTERNAL'].includes(value);
}
export function isProblem(value: ExternalValue): value is Problem {
  if (!(value instanceof Error)) return false;
  const code: ExternalValue = Reflect.get(value, 'code'), details: ExternalValue = Reflect.get(value, 'details');
  return isProblemCode(code) && isDetails(details);
}
export function errorBody(error: Problem): ErrorBody {
  return { error: error.message, code: error.code, details: error.details, cause: error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : null };
}
