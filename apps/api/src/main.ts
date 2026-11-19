import { loadEnv } from './shared/env.js';
import { buildApp } from './presentation/http/app.js';
import { trustOnlyNginx } from './presentation/http/trust-proxy.js';
import { createProductionDependencies } from './composition-root.js';
import { startDemo } from './demo-runtime.js';

/** Expired persistent rate-limit counters are removed in small batches, a few times an hour. */
const RATE_LIMIT_PURGE_INTERVAL_MS = 10 * 60_000;
const RATE_LIMIT_PURGE_BATCH = 1000;

const env = loadEnv();
const { dependencies, adapters, close } = createProductionDependencies(env);
const app = await buildApp(dependencies, {
  logger: { level: env.LOG_LEVEL },
  trustProxy: trustOnlyNginx,
});

const purge = setInterval(() => {
  dependencies.rateLimits.purgeExpired(new Date(), RATE_LIMIT_PURGE_BATCH).then(
    (removed) => removed > 0 && app.log.info({ removed }, 'expired rate-limit counters purged'),
    (error: unknown) => app.log.warn({ err: { type: error instanceof Error ? error.name : typeof error } }, 'rate-limit purge failed'),
  );
}, RATE_LIMIT_PURGE_INTERVAL_MS);
purge.unref();

const stopDemo = env.DEMO_WORKSPACE === 'on' ? await startDemo(dependencies, adapters, app.log) : () => undefined;

const shutdown = async (): Promise<void> => {
  clearInterval(purge);
  stopDemo();
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: env.API_HOST, port: env.API_PORT });
