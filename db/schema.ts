import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

// Retain the previously deployed migration and table; anonymous devices use a separate table.
export const ledgers = sqliteTable('ledgers', {
  userId: text('user_id').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(1),
});

export const deviceLedgers = sqliteTable('device_ledgers', {
  deviceId: text('device_id').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(1),
  generation: text('generation').notNull(),
  updatedAt: integer('updated_at').notNull(),
  cleanupAt: integer('cleanup_at').notNull(),
}, table => [index('device_ledgers_updated_at_idx').on(table.updatedAt), index('device_ledgers_cleanup_at_idx').on(table.cleanupAt)]);
