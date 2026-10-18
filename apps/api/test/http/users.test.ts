import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { JoseTokenService } from '../../src/infrastructure/security/jose-token-service.js';
import type { ApiErrorResponse, MeResponse } from '@aegis/contracts';
import { OTHER_PASSWORD, TEST_PASSWORD, makeCpf, testJwtSecret } from '../support/fixtures.js';
import { bearer, buildTestApp, login, signedInUser } from '../support/test-app.js';
import type { InMemoryStore } from '../support/in-memory-persistence.js';

let app: FastifyInstance;
let store: InMemoryStore;
let jwtSecret: string;

beforeAll(async () => {
  const built = await buildTestApp();
  app = built.app;
  store = built.persistence.store;
  jwtSecret = built.jwtSecret;
});
afterAll(() => app.close());

const getMe = (headers: Record<string, string> = {}) => app.inject({ method: 'GET', url: '/users/me', headers });
const putMe = (payload: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'PUT', url: '/users/me', headers, payload });
const issueFields = (body: ApiErrorResponse) => body.error.issues?.map((issue) => issue.field) ?? [];

describe('authentication hook', () => {
  it('401 without a token, with WWW-Authenticate', async () => {
    const response = await getMe();
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toEqual({ error: { code: 'AUTHENTICATION_ERROR', message: 'Não autenticado.' } });
  });

  it.each([['Basic dXNlcjpwYXNz'], ['Bearer'], ['Bearer not-a-jwt'], ['bearer a.b.c']])('401 for malformed header %j', async (header) => {
    expect((await getMe({ authorization: header })).statusCode).toBe(401);
  });

  it('401 for a token signed with another secret', async () => {
    const { userId } = { userId: (await signedInUser(app)).session.user.id };
    const forged = await new JoseTokenService({ secret: testJwtSecret(), ttlSeconds: 60 }).issue(userId);
    expect((await getMe(bearer(forged.token))).statusCode).toBe(401);
  });

  it('401 for an expired token', async () => {
    const { session } = await signedInUser(app);
    const past = new JoseTokenService({ secret: jwtSecret, ttlSeconds: 60, now: () => new Date(Date.now() - 3_600_000) });
    const expired = await past.issue(session.user.id);
    expect((await getMe(bearer(expired.token))).statusCode).toBe(401);
  });

  it('401 when the token is valid but the user no longer exists', async () => {
    const { token, session } = await signedInUser(app);
    expect((await getMe(bearer(token))).statusCode).toBe(200);

    store.users.delete(session.user.id);
    expect((await getMe(bearer(token))).statusCode).toBe(401);
  });
});

describe('GET /users/me', () => {
  it('200 with the public user fields and workspace roles, never the hash', async () => {
    const { token, registration } = await signedInUser(app);
    const response = await getMe(bearer(token));

    expect(response.statusCode).toBe(200);
    const body = response.json<MeResponse>();
    expect(body.user).toMatchObject({ name: registration.name, email: registration.email, cpf: registration.cpf });
    expect(body.workspaces).toEqual([expect.objectContaining({ kind: 'personal', role: 'OWNER' })]);
    expect(response.body).not.toMatch(/argon2|password/i);
  });
});

describe('PUT /users/me', () => {
  it('200: updates name and CPF of the authenticated user', async () => {
    const { token, registration } = await signedInUser(app);
    const newCpf = makeCpf(55_555);
    const response = await putMe({ name: 'Nome Editado', cpf: newCpf }, bearer(token));

    expect(response.statusCode).toBe(200);
    expect(response.json<MeResponse>().user).toMatchObject({ name: 'Nome Editado', cpf: newCpf, email: registration.email });
    expect((await getMe(bearer(token))).json<MeResponse>().user.name).toBe('Nome Editado');
  });

  it('401 without a token', async () => {
    expect((await putMe({ name: 'Ninguém', cpf: makeCpf(1) })).statusCode).toBe(401);
  });

  it('400: the email cannot be changed, and stays unchanged', async () => {
    const { token, registration } = await signedInUser(app);
    const response = await putMe({ name: 'Nome', cpf: registration.cpf, email: 'novo@example.test' }, bearer(token));

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorResponse>().error.issues).toEqual([{ field: 'email', message: 'O email não pode ser alterado.' }]);
    expect((await getMe(bearer(token))).json<MeResponse>().user.email).toBe(registration.email);
  });

  it('400: identity fields in the body are rejected; another user cannot be targeted', async () => {
    const victim = await signedInUser(app);
    const attacker = await signedInUser(app);
    const response = await putMe(
      { id: victim.session.user.id, userId: victim.session.user.id, name: 'Invasor', cpf: attacker.registration.cpf },
      bearer(attacker.token),
    );

    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(['id', 'userId']);
    expect(store.users.get(victim.session.user.id)?.name).toBe(victim.registration.name);
  });

  it('only ever edits the token owner, whatever the body says', async () => {
    const other = await signedInUser(app);
    const me = await signedInUser(app);
    const response = await putMe({ name: 'Somente Eu', cpf: me.registration.cpf }, bearer(me.token));

    expect(response.json<MeResponse>().user.id).toBe(me.session.user.id);
    expect(store.users.get(other.session.user.id)?.name).toBe(other.registration.name);
  });

  it('400: invalid CPF', async () => {
    const { token } = await signedInUser(app);
    const response = await putMe({ name: 'Nome', cpf: '123.456.789-00' }, bearer(token));
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(['cpf']);
  });

  it('409: CPF already used by another user', async () => {
    const other = await signedInUser(app);
    const { token } = await signedInUser(app);
    const response = await putMe({ name: 'Nome', cpf: other.registration.cpf }, bearer(token));
    expect(response.statusCode).toBe(409);
    expect(issueFields(response.json())).toEqual(['cpf']);
  });

  it.each([
    ['weak new password', { currentPassword: TEST_PASSWORD, password: 'fraca', passwordConfirmation: 'fraca' }, ['password']],
    ['mismatched confirmation', { currentPassword: TEST_PASSWORD, password: OTHER_PASSWORD, passwordConfirmation: 'Aegis-Diff-Pass3' }, ['passwordConfirmation']],
    ['missing current password', { password: OTHER_PASSWORD, passwordConfirmation: OTHER_PASSWORD }, ['currentPassword']],
    ['wrong current password', { currentPassword: 'Wrong-Current-1', password: OTHER_PASSWORD, passwordConfirmation: OTHER_PASSWORD }, ['currentPassword']],
  ])('400: %s', async (_case, passwordFields, fields) => {
    const { token, registration } = await signedInUser(app);
    const response = await putMe({ name: 'Nome', cpf: registration.cpf, ...passwordFields }, bearer(token));
    expect(response.statusCode).toBe(400);
    expect(issueFields(response.json())).toEqual(fields);
  });

  it('changes the password: the old one stops working, the new one signs in', async () => {
    const { token, registration } = await signedInUser(app);
    const response = await putMe(
      { name: registration.name, cpf: registration.cpf, currentPassword: TEST_PASSWORD, password: OTHER_PASSWORD, passwordConfirmation: OTHER_PASSWORD },
      bearer(token),
    );

    expect(response.statusCode).toBe(200);
    expect((await login(app, registration.email, TEST_PASSWORD)).statusCode).toBe(401);
    expect((await login(app, registration.email, OTHER_PASSWORD)).statusCode).toBe(200);
  });
});
