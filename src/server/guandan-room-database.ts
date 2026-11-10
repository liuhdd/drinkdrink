import type { DatabaseStatement, LedgerDatabase, SqlParameter } from '../shared/types.ts';

function storageError(cause: unknown): Error {
  const error = new Error('房间存储暂时不可用，请稍后重试', { cause });
  error.name = 'RoomStorageError';
  return error;
}

// 房间写入均为幂等CAS；临时故障重试不记录敏感SQL参数。 Room writes are idempotent CAS operations; transient retries never log sensitive SQL parameters.
export function roomDatabase(database: LedgerDatabase): LedgerDatabase {
  return { prepare(sql: string): DatabaseStatement {
    const bound = (parameters: SqlParameter[]): DatabaseStatement => ({
      bind: (...values: SqlParameter[]) => bound(values),
      async first() { try { return await database.prepare(sql).bind(...parameters).first(); } catch (cause) { throw storageError(cause); } },
      async all() { try { return await database.prepare(sql).bind(...parameters).all(); } catch (cause) { throw storageError(cause); } },
      async run() {
        for (let attempt = 1; ; attempt++) {
          try { return await database.prepare(sql).bind(...parameters).run(); }
          catch (error) {
            if (!(error instanceof Error) || attempt >= 3 || !/Network connection lost|storage caused object to be reset|reset because its code was updated|database is locked|database table is locked/.test(error.message)) throw storageError(error);
            const delayMs = Math.round(100 * 2 ** (attempt - 1) * (1 + Math.random()));
            console.warn({ operation: 'guandan database write', event: 'operation_retry', attempt, nextAttempt: attempt + 1, delayMs });
            await new Promise<void>(resolve => setTimeout(resolve, delayMs));
          }
        }
      },
    });
    return bound([]);
  } };
}
