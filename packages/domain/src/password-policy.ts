import { ValidationError } from './domain-error.js';

export type PasswordRuleId = 'length' | 'lowercase' | 'uppercase' | 'digit' | 'special';

export interface PasswordRule {
  readonly id: PasswordRuleId;
  readonly label: string;
  readonly test: (password: string) => boolean;
}

/**
 * Password strength policy shared by web (live feedback) and API (authority).
 * The upper bound keeps Argon2 input size predictable.
 */
export class PasswordPolicy {
  static readonly MIN_LENGTH = 10;
  static readonly MAX_LENGTH = 128;

  static readonly MESSAGE =
    `A senha deve ter entre ${PasswordPolicy.MIN_LENGTH} e ${PasswordPolicy.MAX_LENGTH} caracteres, ` +
    'com letra minúscula, letra maiúscula, número e caractere especial.';

  static readonly RULES: readonly PasswordRule[] = [
    {
      id: 'length',
      label: `Entre ${PasswordPolicy.MIN_LENGTH} e ${PasswordPolicy.MAX_LENGTH} caracteres`,
      test: (password) => password.length >= PasswordPolicy.MIN_LENGTH && password.length <= PasswordPolicy.MAX_LENGTH,
    },
    { id: 'lowercase', label: 'Uma letra minúscula', test: (password) => /\p{Ll}/u.test(password) },
    { id: 'uppercase', label: 'Uma letra maiúscula', test: (password) => /\p{Lu}/u.test(password) },
    { id: 'digit', label: 'Um número', test: (password) => /\p{Nd}/u.test(password) },
    { id: 'special', label: 'Um caractere especial', test: (password) => /[^\p{L}\p{N}\s]/u.test(password) },
  ];

  private constructor() {}

  static unmetRules(password: string): PasswordRule[] {
    return PasswordPolicy.RULES.filter((rule) => !rule.test(password));
  }

  static isSatisfiedBy(password: string): boolean {
    return PasswordPolicy.unmetRules(password).length === 0;
  }

  static assert(password: string, field = 'password'): void {
    if (!PasswordPolicy.isSatisfiedBy(password)) throw ValidationError.forField(field, PasswordPolicy.MESSAGE);
  }
}
