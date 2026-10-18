import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LoginResponse, MeResponse } from '@aegis/contracts';
import { buildApp } from '../../src/presentation/http/app.js';
import { createProductionDependencies } from '../../src/composition-root.js';
import { loadEnv } from '../../src/shared/env.js';
import { OTHER_PASSWORD, TEST_PASSWORD, makeCpf, makeRegistration, testJwtSecret } from '../support/fixtures.js';
import { bearer } from '../support/test-app.js';
import { TEST_DATABASE_URL, createMigratedDatabase } from '../support/mysql-test-database.js';

/** Full production wiring (Drizzle + MySQL, Argon2id, JWT) exercised over HTTP. */
describe.skipIf(!TEST_DATABASE_URL)('auth flow against MySQL (integration)', () => {
  let database: Awaited<ReturnType<typeof createMigratedDatabase>>;
  let app: FastifyInstance;
  let close: () => Promise<void>;

  beforeAll(async () => {
    database = await createMigratedDatabase();
    const env = loadEnv({ DATABASE_URL: database.url, JWT_SECRET: testJwtSecret(), AUTH_RATE_LIMIT_MAX: '1000' });
    const production = createProductionDependencies(env);
    close = production.close;
    app = await buildApp(production.dependencies);
  });

  afterAll(async () => {
    await app?.close();
    await close?.();
    await database?.drop();
  });

  it('register → login → me → edit → login with the new password', async () => {
    const registration = makeRegistration({ name: 'Fluxo Completo' });

    const registered = await app.inject({ method: 'POST', url: '/auth/register', payload: registration });
    expect(registered.statusCode).toBe(201);

    const duplicate = await app.inject({ method: 'POST', url: '/auth/register', payload: { ...registration, cpf: makeCpf(77) } });
    expect(duplicate.statusCode).toBe(409);

    const session = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: registration.email, password: TEST_PASSWORD } })).json<LoginResponse>();
    expect(session.workspaces).toEqual([expect.objectContaining({ name: 'Workspace de Fluxo Completo', kind: 'personal', role: 'OWNER' })]);

    const me = await app.inject({ method: 'GET', url: '/users/me', headers: bearer(session.token) });
    expect(me.json<MeResponse>().user.email).toBe(registration.email);

    const edited = await app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: bearer(session.token),
      payload: { name: 'Fluxo Editado', cpf: registration.cpf, currentPassword: TEST_PASSWORD, password: OTHER_PASSWORD, passwordConfirmation: OTHER_PASSWORD },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<MeResponse>().user).toMatchObject({ name: 'Fluxo Editado', email: registration.email });

    const oldPassword = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: registration.email, password: TEST_PASSWORD } });
    expect(oldPassword.statusCode).toBe(401);
    const newPassword = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: registration.email, password: OTHER_PASSWORD } });
    expect(newPassword.statusCode).toBe(200);
  });
});
