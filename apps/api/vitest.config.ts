import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each MySQL integration suite creates and migrates a fresh database in beforeAll;
    // with the suites running in parallel this can exceed the 10 s default.
    hookTimeout: 60_000,
  },
});
