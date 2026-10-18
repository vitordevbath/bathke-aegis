import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorResponse, LoginResponse, RegisterResponse } from '@aegis/contracts';
import { OTHER_PASSWORD, TEST_PASSWORD, makeCpf, makeRegistration } from '../support/fixtures.js';
import { buildTestApp, login, registerUser } from '../support/test-app.js';
import type { InMemoryStore } from '../support/in-memory-persistence.js';

const issueFields = (body: ApiErrorResponse) => body.error.issues?.map((issue) => issue.field) ?? [];

describe('POST /auth/register', () => {
  let app: FastifyInstance;
  let store: InMemoryStore;

  beforeAll(async () => {
    const built = await buildTestApp();
    app = built.app;
    store = built.persistence.store;
  });
  afterAll(() => app.close());

  it('201: creates the user with a personal workspace and OWNER membership, without exposing the hash', async () => {
    const registration = makeRegistration({ name: 'Ana Cadastro', email: '  ANA.CADASTRO@EXAMPLE.TEST ', cpf: '123.456.789-09' });
    const response = await registerUser(app, registration);

    expect(response.statusCode).toBe(201);
    const body = response.json<RegisterResponse>();
    expect(body.user).toMatchObject({ name: 'Ana Cadastro', email: 'ana.cadastro@example.test', cpf: '12345678909' });
    expect(Object.keys(body.user).sort()).toEqual(['cpf', 'createdAt', 'email', 'id', 'name', 'updatedAt']);
    expect(body.workspaces).toEqual([{ id: expect.any(String), name: 'Workspace de Ana Cadastro', kind: 'personal', role: 'OWNER' }]);
    expect(response.body).not.toMatch(/argon2|password|hash/i);
    expect(response.headers['cache-control']).toBe('no-store');

    const stored = store.users.get(body.user.id);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored?.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it('409: rejects a duplicate email regardless of case', async () => {
    const first = makeRegistration();
    await registerUser(app, first);
    const response = await registerUser(app, makeRegistration({ email: first.email.toUpperCase() }));

    expect(response.statusCode).toBe(409);
    expect(response.json<ApiErrorResponse>().error).toMatchObject({ code: 'CONFLICT', issues: [{ field: 'email' }] });
  });

  it('409: rejects a duplicate CPF regardless of formatting', async () => {
    const cpf = makeCpf(123);
    await registerUser(app, makeRegistration({ cpf }));
    const formatted = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    const response = await registerUser(app, makeRegistration({ cpf: formatted }));

    expect(response.statusCode).toBe(409);
    expect(issueFields(response.json())).toEqual(['cpf']);
  });

  it.each([
    ['invalid email', { email: 'not-an-email' }, ['email']],
    ['invalid CPF check digits', { cpf: '123.456.789-00' }, ['cpf']],
    ['repeated-digit CPF', { cpf: '111.111.111-11' }, ['cpf']],
    ['weak password', { password: 'fraca', passwordConfirmation: 'fraca' }, ['password']],
    ['mismatched confirmation', { passwordConfirmation: OTHER_PASSWORD }, ['passwordConfirmation']],
    ['short name', { name: 'A' }, ['name']],
  ])('400: rejects %s', async (_case, overrides, fields) => {
    const before = store.users.size;
    const response = await registerUser(app, makeRegistration(overrides));

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorResponse>().error.code).toBe('VALIDATION_ERROR');
    expect(issueFields(response.json())).toEqual(fields);
    expect(store.users.size).toBe(before);
  });

  it('400: rejects unknown fields such as a role escalation attempt', async () => {
    const response = await registerUser(app, { ...makeRegistration(), role: 'ADMIN' });
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(['role']);
  });

  it('400: answers malformed JSON without leaking internals', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": ',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: 'BAD_REQUEST', message: 'Requisição inválida.' } });
  });
});

describe('POST /auth/login', () => {
  let app: FastifyInstance;
  const registration = makeRegistration();

  beforeAll(async () => {
    ({ app } = await buildTestApp());
    await registerUser(app, registration);
  });
  afterAll(() => app.close());

  it('200: returns a bearer token, the user and their workspaces', async () => {
    const response = await login(app, `  ${registration.email.toUpperCase()} `);

    expect(response.statusCode).toBe(200);
    const body = response.json<LoginResponse>();
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.user.email).toBe(registration.email);
    expect(body.workspaces[0]).toMatchObject({ kind: 'personal', role: 'OWNER' });
    expect(response.body).not.toMatch(/argon2|passwordHash/);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('401: wrong password and unknown email get the identical generic answer', async () => {
    const wrongPassword = await login(app, registration.email, OTHER_PASSWORD);
    const unknownEmail = await login(app, 'ninguem.aqui@example.test', TEST_PASSWORD);

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual({ error: { code: 'AUTHENTICATION_ERROR', message: 'Email ou senha inválidos.' } });
    expect(unknownEmail.body).toBe(wrongPassword.body);
  });

  it('400: rejects a malformed email or an empty password', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x', password: '' } });
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(['email', 'password']);
  });
});

describe('auth rate limiting', () => {
  it('429 after the per-minute limit on /auth/login', async () => {
    const { app } = await buildTestApp({ authRateLimitMax: 2 });
    const attempt = () => login(app, 'limite@example.test', TEST_PASSWORD);

    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    const limited = await attempt();
    expect(limited.statusCode).toBe(429);
    expect(limited.json<ApiErrorResponse>().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    await app.close();
  });
});
