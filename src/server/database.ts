import type { LedgerDatabase, DatabaseStatement, SqlParameter } from '../shared/types.ts';
import { context, problem } from '../shared/errors.ts';

// 在数据库接口边界保留 SQL、参数和原始失败原因。 Preserve SQL, parameters and the original cause at the database interface.
export function diagnosticDatabase(database: LedgerDatabase): LedgerDatabase {
  return { prepare(sql: string): DatabaseStatement {
    const bound = (parameters: SqlParameter[]): DatabaseStatement => {
      const invoke = async <T>(operation: string, execute: () => Promise<T>): Promise<T> => {
        try { return await execute(); }
        catch (caught) {
          const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
          throw problem('STORAGE', `数据库 ${operation} 失败：${cause.message}`, { ...context(`database.${operation}`, null), database: { sql, parameters } }, cause);
        }
      };
      return {
        bind: (...parameters: SqlParameter[]) => bound(parameters),
        first: () => invoke('first', () => database.prepare(sql).bind(...parameters).first()),
        all: () => invoke('all', () => database.prepare(sql).bind(...parameters).all()),
        run: () => invoke('run', () => database.prepare(sql).bind(...parameters).run()),
      };
    };
    return bound([]);
  } };
}
