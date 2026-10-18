import { loadDatabaseEnv } from '../../shared/env.js';
import { runMigrations } from './migrations.js';

/** CLI entry: `npm run db:migrate` (tsx) or `node dist/infrastructure/db/migrate.js` (container). */
const { DATABASE_URL } = loadDatabaseEnv();
await runMigrations(DATABASE_URL);
console.log('Migrations applied.');
