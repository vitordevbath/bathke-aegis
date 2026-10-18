import { SignJWT, jwtVerify } from 'jose';
import { AuthenticationError } from '@aegis/domain';
import type { IssuedToken, TokenService } from '../../application/ports/token-service.js';

const ALGORITHM = 'HS256';
const ISSUER = 'bathke-aegis';
const AUDIENCE = 'aegis-web';
const TOKEN_TYPE = 'access';

export interface JoseTokenServiceOptions {
  /** Validated by `loadEnv` (length, no placeholders). */
  readonly secret: string;
  readonly ttlSeconds: number;
  readonly now?: () => Date;
}

/**
 * HS256 access tokens. Claims: `sub` (user id), `typ`, `iss`, `aud`, `iat`, `exp`.
 * Nothing else — no email, CPF or other personal data.
 */
export class JoseTokenService implements TokenService {
  private readonly key: Uint8Array;
  private readonly ttlSeconds: number;
  private readonly now: () => Date;

  constructor(options: JoseTokenServiceOptions) {
    this.key = new TextEncoder().encode(options.secret);
    this.ttlSeconds = options.ttlSeconds;
    this.now = options.now ?? (() => new Date());
  }

  async issue(userId: string): Promise<IssuedToken> {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const token = await new SignJWT({ typ: TOKEN_TYPE })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.ttlSeconds)
      .sign(this.key);
    return { token, expiresIn: this.ttlSeconds };
  }

  async verify(token: string): Promise<{ userId: string }> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: this.now(),
      });
      if (payload['typ'] !== TOKEN_TYPE || typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new AuthenticationError();
      }
      return { userId: payload.sub };
    } catch {
      // Bad signature, expired, wrong alg/iss/aud, malformed: all look the same to the caller.
      throw new AuthenticationError();
    }
  }
}
