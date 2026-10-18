import { randomUUID } from 'node:crypto';
import { Cpf, Email, Entity, ValidationError } from '@aegis/domain';

/** Persistence shape of a user. Only repositories should need it. */
export interface UserSnapshot {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly cpf: string;
  readonly passwordHash: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const NAME_MIN = 2;
const NAME_MAX = 120;

function normalizeName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw ValidationError.forField('name', `O nome deve ter entre ${NAME_MIN} e ${NAME_MAX} caracteres.`);
  }
  return name;
}

function requireHash(passwordHash: string): string {
  if (passwordHash.length === 0) throw new ValidationError('Hash de senha ausente.');
  return passwordHash;
}

/**
 * A person with an account. Invariants: valid name, normalized email and CPF,
 * a non-empty password hash. The email is fixed at registration — there is
 * deliberately no way to change it. Fields are runtime-private (`#`), so the
 * hash never leaks through accidental serialization.
 */
export class User extends Entity<string> {
  #name: string;
  readonly #email: Email;
  #cpf: Cpf;
  #passwordHash: string;
  readonly #createdAt: Date;
  #updatedAt: Date;

  private constructor(id: string, name: string, email: Email, cpf: Cpf, passwordHash: string, createdAt: Date, updatedAt: Date) {
    super(id);
    this.#name = name;
    this.#email = email;
    this.#cpf = cpf;
    this.#passwordHash = passwordHash;
    this.#createdAt = createdAt;
    this.#updatedAt = updatedAt;
  }

  /** Creates a brand-new user. The caller provides an already-computed password hash. */
  static register(input: { name: string; email: Email; cpf: Cpf; passwordHash: string }, now: Date = new Date()): User {
    return new User(randomUUID(), normalizeName(input.name), input.email, input.cpf, requireHash(input.passwordHash), now, now);
  }

  /** Rehydrates a persisted user, re-checking every invariant. */
  static restore(snapshot: UserSnapshot): User {
    return new User(
      snapshot.id,
      normalizeName(snapshot.name),
      Email.create(snapshot.email),
      Cpf.create(snapshot.cpf),
      requireHash(snapshot.passwordHash),
      snapshot.createdAt,
      snapshot.updatedAt,
    );
  }

  get name(): string {
    return this.#name;
  }

  get email(): string {
    return this.#email.value;
  }

  get cpf(): string {
    return this.#cpf.value;
  }

  get passwordHash(): string {
    return this.#passwordHash;
  }

  get createdAt(): Date {
    return this.#createdAt;
  }

  get updatedAt(): Date {
    return this.#updatedAt;
  }

  /** Changes the editable profile fields. Email is not one of them. */
  updateProfile(input: { name: string; cpf: Cpf }, now: Date = new Date()): void {
    this.#name = normalizeName(input.name);
    this.#cpf = input.cpf;
    this.#updatedAt = now;
  }

  changePasswordHash(passwordHash: string, now: Date = new Date()): void {
    this.#passwordHash = requireHash(passwordHash);
    this.#updatedAt = now;
  }

  toSnapshot(): UserSnapshot {
    return {
      id: this.id,
      name: this.#name,
      email: this.#email.value,
      cpf: this.#cpf.value,
      passwordHash: this.#passwordHash,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
    };
  }
}
