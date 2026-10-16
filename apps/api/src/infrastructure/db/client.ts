import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

export type Database = MySql2Database<typeof schema>;

/** Creates a pooled Drizzle client. Not wired into the app until a use case needs it. */
export function createDatabase(databaseUrl: string): { db: Database; close: () => Promise<void> } {
  const pool = mysql.createPool(databaseUrl);
  return {
    db: drizzle(pool, { schema, mode: 'default' }),
    close: () => pool.end(),
  };
}
