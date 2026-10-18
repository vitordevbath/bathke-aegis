import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createDatabase } from './client.js';

/** `apps/api/drizzle`, resolved the same way from `src/` (tsx) and `dist/` (node). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/** Applies pending versioned migrations. Idempotent: applied ones are tracked in `__drizzle_migrations`. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDatabase(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}
