import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

export type Database = MySql2Database<typeof schema>;

/** Creates a pooled Drizzle client. Dates are exchanged with MySQL in UTC. */
export function createDatabase(databaseUrl: string): { db: Database; close: () => Promise<void> } {
  const pool = mysql.createPool({ uri: databaseUrl, timezone: 'Z' });
  return {
    db: drizzle(pool, { schema, mode: 'default' }),
    close: () => pool.end(),
  };
}
