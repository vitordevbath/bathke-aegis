import { afterAll } from 'vitest';
import { createDatabase } from '../../src/infrastructure/db/client.js';
import { createDrizzleRepositories } from '../../src/infrastructure/db/drizzle-repositories.js';
import { createInMemoryPersistence } from '../support/in-memory-persistence.js';
import { describeEventRepositoryContract } from '../support/event-repository-contract.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

describeEventRepositoryContract('in-memory', async () => ({ repositories: createInMemoryPersistence().repositories }));

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
});

describeEventRepositoryContract(
  'Drizzle / MySQL',
  async () => {
    const database = await createMigratedDatabase();
    const connection = createDatabase(database.url);
    cleanups.push(database.drop, connection.close);
    return { repositories: createDrizzleRepositories(connection.db) };
  },
  Boolean(TEST_DATABASE_URL),
);
