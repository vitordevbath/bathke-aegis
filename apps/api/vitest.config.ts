import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each MySQL integration suite creates and migrates a fresh database in beforeAll;
    // with the suites running in parallel this can exceed the 10 s default.
    hookTimeout: 60_000,
    // Real Argon2id (64 MiB per hash, register + login per tenant) across parallel files
    // exceeds the 5 s default on a loaded machine. A wider limit changes no assertion.
    testTimeout: 30_000,
  },
});
