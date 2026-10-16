import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoute } from './routes/health.route.js';

/** Builds the HTTP application without binding a port, so tests can use `inject`. */
export async function buildApp(options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(options);
  await app.register(healthRoute);
  return app;
}
