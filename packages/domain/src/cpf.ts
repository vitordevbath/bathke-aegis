import { ValidationError } from './domain-error.js';

/** Accepts `12345678909` or `123.456.789-09` (separators optional, nothing else). */
const INPUT_PATTERN = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;

/** Weighted mod-11 check digit over `digits` (weights descend from digits.length + 1). */
function checkDigit(digits: readonly number[]): number {
  const weightStart = digits.length + 1;
  const sum = digits.reduce((total, digit, index) => total + digit * (weightStart - index), 0);
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

/**
 * Brazilian CPF. Stored as 11 digits only; `formatted` renders the
 * `000.000.000-00` mask. Validation checks the input shape, rejects
 * repeated-digit sequences and verifies both check digits.
 */
export class Cpf {
  private constructor(private readonly digits: string) {}

  /** Removes formatting separators. Does not validate. */
  static normalize(raw: string): string {
    return raw.trim().replace(/[.-]/g, '');
  }

  static isValid(raw: string): boolean {
    const trimmed = raw.trim();
    if (!INPUT_PATTERN.test(trimmed)) return false;

    const digits = Cpf.normalize(trimmed);
    if (/^(\d)\1{10}$/.test(digits)) return false;

    const numbers = Array.from(digits, Number);
    const first = checkDigit(numbers.slice(0, 9));
    const second = checkDigit(numbers.slice(0, 10));
    return numbers[9] === first && numbers[10] === second;
  }

  static create(raw: string): Cpf {
    if (!Cpf.isValid(raw)) throw ValidationError.forField('cpf', 'Informe um CPF válido.');
    return new Cpf(Cpf.normalize(raw));
  }

  /** 11 digits, no separators — the persisted form. */
  get value(): string {
    return this.digits;
  }

  get formatted(): string {
    return Cpf.format(this.digits);
  }

  /** Masks up to 11 digits progressively (`123.456.789-09`); useful for input fields. */
  static format(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 11);
    return digits
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }

  equals(other: Cpf): boolean {
    return other.digits === this.digits;
  }
}
