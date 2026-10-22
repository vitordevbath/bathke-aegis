import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { LoginResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createUseCases } from '../../src/composition-root.js';
import { Argon2PasswordHasher } from '../../src/infrastructure/security/argon2-password-hasher.js';
import { JoseTokenService } from '../../src/infrastructure/security/jose-token-service.js';
import { createInMemoryPersistence } from './in-memory-persistence.js';
import { TEST_PASSWORD, makeRegistration, testJwtSecret } from './fixtures.js';

/** Real HTTP stack, real Argon2id and JWT; in-memory persistence. */
export async function buildTestApp(options: { authRateLimitMax?: number; ingestRateLimitMax?: number } = {}) {
  const persistence = createInMemoryPersistence();
  const jwtSecret = testJwtSecret();
  const tokens = new JoseTokenService({ secret: jwtSecret, ttlSeconds: 900 });
  const dependencies = createUseCases(
    { repositories: persistence.repositories, unitOfWork: persistence.unitOfWork, hasher: new Argon2PasswordHasher(), tokens },
    options.authRateLimitMax ?? 1000,
    options.ingestRateLimitMax ?? 1000,
  );
  const app = await buildApp(dependencies);
  return { app, persistence, jwtSecret };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export function registerUser(app: FastifyInstance, payload: object = makeRegistration()): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: '/auth/register', payload });
}

export function login(app: FastifyInstance, email: string, password = TEST_PASSWORD): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
}

/** Registers a fresh user and signs in; returns the registration payload and the session. */
export async function signedInUser(app: FastifyInstance, overrides: Parameters<typeof makeRegistration>[0] = {}) {
  const registration = makeRegistration(overrides);
  const registered = await registerUser(app, registration);
  if (registered.statusCode !== 201) throw new Error(`register failed: ${registered.statusCode}`);
  const session = (await login(app, registration.email, registration.password)).json<LoginResponse>();
  return { registration, session, token: session.token };
}
