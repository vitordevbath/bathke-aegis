import { randomBytes } from 'node:crypto';

/**
 * Synthetic test data. CPFs are generated from an obviously artificial
 * sequential base (`900000000 + n`) and completed with the mod-11 check digits
 * computed here independently from the production implementation.
 */
export function makeCpf(n: number): string {
  const base = Array.from(String(900_000_000 + n).padStart(9, '0'), Number);
  const digit = (digits: number[]) => {
    const sum = digits.reduce((total, value, index) => total + value * (digits.length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  const first = digit(base);
  const second = digit([...base, first]);
  return [...base, first, second].join('');
}

export const TEST_PASSWORD = 'Aegis-Test-Pass1';
export const OTHER_PASSWORD = 'Aegis-Other-Pass2';

let sequence = 0;

/** A fresh, valid registration payload with unique email and CPF. */
export function makeRegistration(overrides: Partial<Record<'name' | 'email' | 'cpf' | 'password' | 'passwordConfirmation', string>> = {}) {
  sequence += 1;
  const tag = `${Date.now().toString(36)}${sequence}`;
  return {
    name: `Pessoa Teste ${sequence}`,
    email: `pessoa.teste.${tag}@example.test`,
    cpf: makeCpf(sequence + Math.floor(Math.random() * 90_000_000)),
    password: TEST_PASSWORD,
    passwordConfirmation: TEST_PASSWORD,
    ...overrides,
  };
}

/** Runtime-generated JWT secret: no secret-looking literal is committed. */
export const testJwtSecret = () => randomBytes(48).toString('base64url');
