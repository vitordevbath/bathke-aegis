/** High-entropy random secrets (pairing codes, machine tokens) and their storage form. */
export interface MachineSecrets {
  /** A fresh transport-safe secret from a CSPRNG. */
  generate(): string;
  /** Deterministic hash suitable for random secrets, usable as a lookup key. */
  hash(secret: string): string;
  /** Constant-time comparison against a stored hash; false for a malformed hash. */
  matches(secret: string, expectedHash: string): boolean;
}
