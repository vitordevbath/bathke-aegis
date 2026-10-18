import { describe, expect, it } from 'vitest';
import { Cpf, Email, PasswordPolicy, ValidationError } from '../src/index.js';

// Textbook example CPFs (sequential / patterned); not tied to any real person.
const VALID_CPFS = ['123.456.789-09', '12345678909', '111.444.777-35', ' 111.444.777-35 '];

describe('Cpf', () => {
  it.each(VALID_CPFS)('accepts %j', (raw) => {
    expect(Cpf.isValid(raw)).toBe(true);
  });

  it('normalizes formatted input to 11 digits', () => {
    expect(Cpf.create('123.456.789-09').value).toBe('12345678909');
    expect(Cpf.create(' 111.444.777-35 ').value).toBe('11144477735');
  });

  it('renders the formatted mask', () => {
    expect(Cpf.create('12345678909').formatted).toBe('123.456.789-09');
    expect(Cpf.format('1234567')).toBe('123.456.7');
    expect(Cpf.format('123456789099999')).toBe('123.456.789-09');
  });

  it.each(['00000000000', '11111111111', '222.222.222-22', '99999999999'])('rejects repeated digits %j', (raw) => {
    expect(Cpf.isValid(raw)).toBe(false);
  });

  it.each([
    ['wrong first check digit', '123.456.789-19'],
    ['wrong second check digit', '123.456.789-08'],
    ['both check digits wrong', '111.444.777-00'],
  ])('rejects %s', (_case, raw) => {
    expect(Cpf.isValid(raw)).toBe(false);
  });

  it.each(['', '1234567890', '123456789091', '123.456.789/09', 'abc.def.ghi-jk', '123 456 789 09', '12a45678909'])(
    'rejects malformed input %j',
    (raw) => {
      expect(Cpf.isValid(raw)).toBe(false);
    },
  );

  it('throws a field-addressed ValidationError for invalid input', () => {
    expect(() => Cpf.create('123.456.789-00')).toThrow(ValidationError);
    try {
      Cpf.create('11111111111');
    } catch (error) {
      expect((error as ValidationError).issues).toEqual([{ field: 'cpf', message: 'Informe um CPF válido.' }]);
    }
  });

  it('compares by value', () => {
    expect(Cpf.create('123.456.789-09').equals(Cpf.create('12345678909'))).toBe(true);
  });
});

describe('Email', () => {
  it.each(['analyst@example.com', 'first.last+tag@sub.example.org', 'a_b-c@test-domain.io'])('accepts %j', (raw) => {
    expect(Email.isValid(raw)).toBe(true);
  });

  it('trims and lower-cases before persisting', () => {
    expect(Email.create('  EXEMPLO@EMAIL.COM ').value).toBe('exemplo@email.com');
  });

  it.each([
    '',
    '   ',
    'plainaddress',
    '@example.com',
    'user@',
    'user@localhost',
    'user@@example.com',
    'user name@example.com',
    'user@exa mple.com',
    '.user@example.com',
    'user..name@example.com',
    'user@-example.com',
  ])('rejects %j', (raw) => {
    expect(Email.isValid(raw)).toBe(false);
  });

  it('rejects addresses longer than 254 characters', () => {
    expect(Email.isValid(`${'a'.repeat(64)}@${'b'.repeat(186)}.com`)).toBe(false);
  });

  it('throws ValidationError for invalid input', () => {
    expect(() => Email.create('not-an-email')).toThrow(ValidationError);
  });

  it('compares normalized values', () => {
    expect(Email.create('Ana@Example.com').equals(Email.create('ana@example.com'))).toBe(true);
  });
});

describe('PasswordPolicy', () => {
  it.each(['Aegis-Strong1', 'Correta#Senha9', 'Ünïcödé-Pass1'])('accepts strong password %j', (password) => {
    expect(PasswordPolicy.isSatisfiedBy(password)).toBe(true);
  });

  it.each([
    ['too short', 'Ab1!short', 'length'],
    ['no lowercase', 'AEGIS-STRONG1', 'lowercase'],
    ['no uppercase', 'aegis-strong1', 'uppercase'],
    ['no digit', 'Aegis-Strong', 'digit'],
    ['no special character', 'AegisStrong1', 'special'],
  ])('rejects password with %s', (_case, password, rule) => {
    expect(PasswordPolicy.unmetRules(password).map((unmet) => unmet.id)).toEqual([rule]);
  });

  it('treats whitespace as not special', () => {
    expect(PasswordPolicy.isSatisfiedBy('Aegis Strong1')).toBe(false);
  });

  it('rejects passwords above the maximum length', () => {
    expect(PasswordPolicy.isSatisfiedBy(`Aa1!${'x'.repeat(PasswordPolicy.MAX_LENGTH)}`)).toBe(false);
  });

  it('assert throws a ValidationError addressed to the given field', () => {
    try {
      PasswordPolicy.assert('weak', 'newPassword');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues[0]?.field).toBe('newPassword');
    }
  });
});
