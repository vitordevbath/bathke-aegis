import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { RegisterUser } from '../../application/use-cases/register-user.js';
import type { AuthenticateUser } from '../../application/use-cases/authenticate-user.js';
import type { ResolveAuthenticatedUser } from '../../application/use-cases/resolve-authenticated-user.js';
import type { GetCurrentUser } from '../../application/use-cases/get-current-user.js';
import type { UpdateCurrentUser } from '../../application/use-cases/update-current-user.js';
import { errorHandler } from './error-handler.js';
import { healthRoute } from './routes/health.route.js';
import { authRoute } from './routes/auth.route.js';
import { usersRoute } from './routes/users.route.js';

/** Use cases the HTTP layer delegates to. Assembled by the composition root (or by tests). */
export interface AppDependencies {
  readonly registerUser: RegisterUser;
  readonly authenticateUser: AuthenticateUser;
  readonly resolveAuthenticatedUser: ResolveAuthenticatedUser;
  readonly getCurrentUser: GetCurrentUser;
  readonly updateCurrentUser: UpdateCurrentUser;
  /** Requests per client IP per minute on each auth route. */
  readonly authRateLimitMax: number;
}

/** Builds the HTTP application without binding a port, so tests can use `inject`. */
export async function buildApp(dependencies: AppDependencies, options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(options);

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }));
  app.decorateRequest('currentUser', null);

  // In-memory, per-route limits only (opt-in via route config). Enough for a single API instance.
  await app.register(rateLimit, { global: false });

  await app.register(healthRoute);
  await app.register(authRoute, {
    registerUser: dependencies.registerUser,
    authenticateUser: dependencies.authenticateUser,
    rateLimitMax: dependencies.authRateLimitMax,
  });
  await app.register(usersRoute, {
    resolveAuthenticatedUser: dependencies.resolveAuthenticatedUser,
    getCurrentUser: dependencies.getCurrentUser,
    updateCurrentUser: dependencies.updateCurrentUser,
  });

  return app;
}
