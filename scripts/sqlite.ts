import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { ExternalValue, LedgerDatabase, DatabaseStatement, SqlParameter } from '../src/shared/types.ts';
import { field, list } from '../src/shared/values.ts';

export function migrationTags(): string[] {
  const journal: ExternalValue = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  return list(field(journal, 'entries')).map(entry => {
    const tag = field(entry, 'tag');
    if (typeof tag !== 'string' || !/^[0-9]{4}_[a-z_]+$/.test(tag)) throw new TypeError('数据库迁移标识无效');
    return tag;
  });
}
export function applyMigrations(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS local_migrations (tag TEXT PRIMARY KEY)');
  for (const tag of migrationTags()) {
    if (db.prepare('SELECT tag FROM local_migrations WHERE tag = ?').get(tag)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8'));
      db.prepare('INSERT INTO local_migrations (tag) VALUES (?)').run(tag);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}
export function sqliteAdapter(db: DatabaseSync): LedgerDatabase {
  return { prepare(sql: string): DatabaseStatement {
    const statement = db.prepare(sql);
    const bind = (...params: SqlParameter[]): DatabaseStatement => ({
      bind,
      async first() { return statement.get(...params) ?? null; },
      async all() { return { results: statement.all(...params) }; },
      async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
    });
    return bind();
  } };
}
