import { loadEnv } from './shared/env.js';
import { buildApp } from './presentation/http/app.js';

const env = loadEnv();
const app = await buildApp({ logger: { level: env.LOG_LEVEL } });

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: env.API_HOST, port: env.API_PORT });
