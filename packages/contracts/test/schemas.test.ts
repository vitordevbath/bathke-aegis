import { describe, expect, it } from 'vitest';
import {
  EMAIL_IMMUTABLE_MESSAGE,
  LoginRequestSchema,
  PASSWORD_MISMATCH_MESSAGE,
  RegisterRequestSchema,
  UpdateCurrentUserRequestSchema,
} from '../src/index.js';

const fieldsOf = (result: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

const validRegistration = {
  name: '  Ana Teste ',
  email: ' ANA.TESTE@EXAMPLE.COM ',
  cpf: '123.456.789-09',
  password: 'Aegis-Strong1',
  passwordConfirmation: 'Aegis-Strong1',
};

describe('RegisterRequestSchema', () => {
  it('normalizes name, email and CPF', () => {
    const parsed = RegisterRequestSchema.parse(validRegistration);
    expect(parsed).toMatchObject({ name: 'Ana Teste', email: 'ana.teste@example.com', cpf: '12345678909' });
  });

  it('rejects a mismatched confirmation on the confirmation field', () => {
    const result = RegisterRequestSchema.safeParse({ ...validRegistration, passwordConfirmation: 'Aegis-Strong2' });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['passwordConfirmation'], message: PASSWORD_MISMATCH_MESSAGE }),
    ]);
  });

  it('rejects weak password, invalid email and invalid CPF together', () => {
    const result = RegisterRequestSchema.safeParse({
      ...validRegistration,
      email: 'nope',
      cpf: '111.111.111-11',
      password: 'weak',
      passwordConfirmation: 'weak',
    });
    expect(fieldsOf(result)).toEqual(['email', 'cpf', 'password']);
  });

  it('rejects unknown fields', () => {
    expect(RegisterRequestSchema.safeParse({ ...validRegistration, role: 'OWNER' }).success).toBe(false);
  });
});

describe('LoginRequestSchema', () => {
  it('requires email format and a non-empty password', () => {
    expect(fieldsOf(LoginRequestSchema.safeParse({ email: 'x', password: '' }))).toEqual(['email', 'password']);
  });
});

describe('UpdateCurrentUserRequestSchema', () => {
  const base = { name: 'Ana Teste', cpf: '111.444.777-35' };

  it('allows profile changes without touching the password', () => {
    expect(UpdateCurrentUserRequestSchema.parse({ ...base, currentPassword: '', password: '', passwordConfirmation: '' })).toEqual({
      name: 'Ana Teste',
      cpf: '11144477735',
      passwordChange: undefined,
    });
  });

  it('requires current password, policy and confirmation when changing the password', () => {
    const result = UpdateCurrentUserRequestSchema.safeParse({ ...base, password: 'weak', passwordConfirmation: 'other' });
    expect(fieldsOf(result)).toEqual(['currentPassword', 'password', 'passwordConfirmation']);
  });

  it('produces a password change command when all fields are valid', () => {
    const parsed = UpdateCurrentUserRequestSchema.parse({
      ...base,
      currentPassword: 'Old-Password1',
      password: 'New-Password1',
      passwordConfirmation: 'New-Password1',
    });
    expect(parsed.passwordChange).toEqual({ currentPassword: 'Old-Password1', newPassword: 'New-Password1' });
  });

  it('rejects any attempt to send an email', () => {
    const result = UpdateCurrentUserRequestSchema.safeParse({ ...base, email: 'other@example.com' });
    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['email'], message: EMAIL_IMMUTABLE_MESSAGE })]);
  });

  it('rejects identity fields in the body', () => {
    const result = UpdateCurrentUserRequestSchema.safeParse({ ...base, id: 'someone-else', userId: 'someone-else' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['id', 'userId'] });
  });
});
