import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { runMigrations } from '../../src/infrastructure/db/migrations.js';

/**
 * Integration tests run only when `TEST_DATABASE_URL` points to a disposable
 * MySQL server (CI service container or a local throwaway). The URL's user
 * must be allowed to create and drop databases.
 */
export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];

/** Creates an empty, uniquely named database, applies all migrations from zero, and returns its URL. */
export async function createMigratedDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  const name = `aegis_it_${randomBytes(6).toString('hex')}`;
  const server = new URL(TEST_DATABASE_URL);
  server.pathname = '/';

  const admin = await mysql.createConnection({ uri: server.toString() });
  await admin.query(`CREATE DATABASE \`${name}\``);

  const url = new URL(server);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());

  return {
    url: url.toString(),
    drop: async () => {
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.end();
    },
  };
}
