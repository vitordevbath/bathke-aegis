/** One-way password hashing. Implementations must use a memory-hard KDF. */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /** Returns false on mismatch or on a malformed hash; never throws for wrong passwords. */
  verify(hash: string, plain: string): Promise<boolean>;
}
