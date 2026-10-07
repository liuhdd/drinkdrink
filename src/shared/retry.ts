import { isProblem } from './errors.ts';
import { failureLog } from './logging.ts';

// 外部接口最多执行三次，指数退避附加抖动，并原样抛出最后失败。 External interfaces attempt at most three times with exponential backoff and jitter, then rethrow the last failure.
export async function retryOperation<T>(operation: string, execute: () => Promise<T>, retryable: (error: Error) => boolean): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await execute(); }
    catch (caught) {
      if (!(caught instanceof Error) || attempt >= 3 || !retryable(caught)) throw caught;
      const delayMs = Math.round(100 * 2 ** (attempt - 1) * (1 + Math.random()));
      console.warn({ ...failureLog(operation, caught), event: 'operation_retry', attempt, nextAttempt: attempt + 1, delayMs });
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }
}
export function retryableDatabaseError(error: Error): boolean {
  if (!isProblem(error) || error.code !== 'STORAGE' || !(error.cause instanceof Error)) return false;
  return /Network connection lost|storage caused object to be reset|reset because its code was updated|database is locked|database table is locked/.test(error.cause.message);
}
export function retryableHttpError(error: Error): boolean {
  if (!isProblem(error)) return false;
  if (error.code === 'NETWORK') return true;
  return (error.code === 'HTTP' || error.code === 'RESPONSE') && error.details.status !== null && [408, 429, 502, 503, 504].includes(error.details.status);
}
