export interface IssuedToken {
  readonly token: string;
  /** Lifetime in seconds. */
  readonly expiresIn: number;
}

/** Issues and verifies stateless access tokens. Tokens carry the user id only. */
export interface TokenService {
  issue(userId: string): Promise<IssuedToken>;
  /** Resolves the subject of a valid token; throws `AuthenticationError` otherwise. */
  verify(token: string): Promise<{ userId: string }>;
}
