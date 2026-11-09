import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { LoginResponse, PairAgentResponse, PairingCodeResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { DEFAULT_PAIRING_LIMITS, createUseCases, type PairingLimits } from '../../src/composition-root.js';
import type { AppDependencies } from '../../src/presentation/http/app.js';
import { NodeMachineSecrets } from '../../src/infrastructure/security/node-machine-secrets.js';
import { Argon2PasswordHasher } from '../../src/infrastructure/security/argon2-password-hasher.js';
import { JoseTokenService } from '../../src/infrastructure/security/jose-token-service.js';
import { createInMemoryPersistence } from './in-memory-persistence.js';
import { TEST_PASSWORD, makeRegistration, testJwtSecret } from './fixtures.js';

/** Generous enough that suites only hit a limit when they set one on purpose. */
const RELAXED_PAIRING_LIMITS: PairingLimits = { ...DEFAULT_PAIRING_LIMITS, pairRateLimitMax: 1000, invalidAttemptsMax: 1000, codesPerHostPerHour: 1000 };

export interface BuildTestAppOptions {
  readonly authRateLimitMax?: number;
  readonly ingestRateLimitMax?: number;
  readonly pairing?: Partial<PairingLimits>;
  /** Replaces wired use cases, for behavior no real credential can reach. */
  readonly overrides?: Partial<AppDependencies>;
  /** Receives every line the application logs. */
  readonly logLines?: string[];
}

/** Real HTTP stack, real Argon2id and JWT; in-memory persistence. */
export async function buildTestApp(options: BuildTestAppOptions = {}) {
  const persistence = createInMemoryPersistence();
  const jwtSecret = testJwtSecret();
  const tokens = new JoseTokenService({ secret: jwtSecret, ttlSeconds: 900 });
  const dependencies = createUseCases(
    { repositories: persistence.repositories, unitOfWork: persistence.unitOfWork, hasher: new Argon2PasswordHasher(), tokens, secrets: new NodeMachineSecrets() },
    options.authRateLimitMax ?? 1000,
    options.ingestRateLimitMax ?? 1000,
    { ...RELAXED_PAIRING_LIMITS, ...options.pairing },
  );
  const { logLines } = options;
  const stream = logLines && new Writable({ write: (chunk, _encoding, done) => (logLines.push(String(chunk)), done()) });
  const app = await buildApp({ ...dependencies, ...options.overrides }, stream ? { logger: { level: 'trace', stream } } : {});
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

/** An OWNER requests a code for a host. */
export async function requestPairingCode(app: FastifyInstance, userToken: string, workspaceId: string, hostId: string): Promise<PairingCodeResponse> {
  const response = await app.inject({ method: 'POST', url: `/workspaces/${workspaceId}/hosts/${hostId}/pairing-codes`, headers: bearer(userToken) });
  if (response.statusCode !== 201) throw new Error(`pairing code failed: ${response.statusCode}`);
  return response.json<PairingCodeResponse>();
}

export const redeemCode = (app: FastifyInstance, code: string) => app.inject({ method: 'POST', url: '/agent/pair', payload: { code } });

/** Full pairing of a host: returns the credential as the machine would receive it. */
export async function pairHost(app: FastifyInstance, userToken: string, workspaceId: string, hostId: string): Promise<PairAgentResponse> {
  const { code } = await requestPairingCode(app, userToken, workspaceId, hostId);
  const response = await redeemCode(app, code);
  if (response.statusCode !== 201) throw new Error(`pairing failed: ${response.statusCode}`);
  return response.json<PairAgentResponse>();
}
