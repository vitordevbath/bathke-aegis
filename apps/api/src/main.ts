import { loadEnv } from './shared/env.js';
import { buildApp } from './presentation/http/app.js';
import { createProductionDependencies } from './composition-root.js';

const env = loadEnv();
const { dependencies, close } = createProductionDependencies(env);
const app = await buildApp(dependencies, {
  logger: { level: env.LOG_LEVEL },
  // The API is reachable only through Nginx (one hop), so the client IP used by
  // rate limiting is the address Nginx appends to X-Forwarded-For.
  trustProxy: (_address, hop) => hop === 0,
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: env.API_HOST, port: env.API_PORT });
