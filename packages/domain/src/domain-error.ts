/**
 * Base class for errors raised by domain rules. `code` is a stable,
 * machine-readable identifier that presentation layers can map to
 * transport errors (e.g. HTTP status codes).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
