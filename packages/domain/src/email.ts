import { ValidationError } from './domain-error.js';

/**
 * Pragmatic address pattern (applied after normalization): RFC 5322 "atext"
 * local part and a dotted domain of DNS labels. Quoted local parts and IP
 * literals are intentionally rejected.
 */
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Email address, always stored trimmed and lower-cased. */
export class Email {
  static readonly MAX_LENGTH = 254;

  private constructor(private readonly normalized: string) {}

  static normalize(raw: string): string {
    return raw.trim().toLowerCase();
  }

  static isValid(raw: string): boolean {
    const value = Email.normalize(raw);
    return value.length > 0 && value.length <= Email.MAX_LENGTH && EMAIL_PATTERN.test(value);
  }

  static create(raw: string): Email {
    if (!Email.isValid(raw)) throw ValidationError.forField('email', 'Informe um email válido.');
    return new Email(Email.normalize(raw));
  }

  get value(): string {
    return this.normalized;
  }

  equals(other: Email): boolean {
    return other.normalized === this.normalized;
  }

  toString(): string {
    return this.normalized;
  }
}
