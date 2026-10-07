import { errorBody, isProblem } from './errors.ts';
import type { ErrorBody } from './errors.ts';

export interface FailureLog { event: 'operation_failed'; operation: string; error: ErrorBody | { name: string; message: string; cause: string | null }; }
export function failureLog(operation: string, error: Error): FailureLog {
  return { event: 'operation_failed', operation, error: isProblem(error) ? errorBody(error) : { name: error.name, message: error.message, cause: error.cause instanceof Error ? error.cause.message : null } };
}
