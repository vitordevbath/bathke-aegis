import { mysqlTable, varchar, char, timestamp, int } from 'drizzle-orm/mysql-core';

/**
 * Drizzle schema. Only `users` is declared so far; hosts, detection_rules,
 * incidents and investigations are added in BF 03 alongside their use cases.
 * No migrations have been generated or applied yet.
 */
export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  cpf: char('cpf', { length: 11 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});
