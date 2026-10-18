/**
 * Base class for errors raised by domain and application rules. `code` is a
 * stable, machine-readable identifier that presentation layers map to
 * transport errors (e.g. HTTP status codes). Messages are safe to show to
 * end users: they never carry secrets, hashes or internal details.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A single invalid input field, addressed by its transport name. */
export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

/** Input violates a domain rule (format, policy, invariant). */
export class ValidationError extends DomainError {
  override readonly code = 'VALIDATION_ERROR';

  constructor(
    message: string,
    readonly issues: readonly FieldIssue[] = [],
  ) {
    super(message);
  }

  static forField(field: string, message: string): ValidationError {
    return new ValidationError(message, [{ field, message }]);
  }
}

/** Caller identity could not be established. Deliberately generic. */
export class AuthenticationError extends DomainError {
  override readonly code = 'AUTHENTICATION_ERROR';

  constructor(message = 'Não autenticado.') {
    super(message);
  }
}

/** Caller is a member of the workspace, but their role does not allow the action. */
export class ForbiddenError extends DomainError {
  override readonly code = 'FORBIDDEN';

  constructor(message = 'Seu papel neste workspace não permite esta ação.') {
    super(message);
  }
}

/** A uniqueness rule would be broken (e.g. email or CPF already registered). */
export class ConflictError extends DomainError {
  override readonly code = 'CONFLICT';

  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** A referenced resource does not exist (or is not visible to the caller). */
export class NotFoundError extends DomainError {
  override readonly code = 'NOT_FOUND';

  constructor(message = 'Recurso não encontrado.') {
    super(message);
  }
}
