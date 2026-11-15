import { PAIRING_ATTEMPTS_LIMIT_MESSAGE, TooManyRequestsError } from '@aegis/domain';
import type { RateLimitStore } from './ports/rate-limit-store.js';

export interface PairingThrottleLimits {
  /** Requests per client per minute on `POST /agent/pair`. */
  readonly requestsPerMinute: number;
  /** Refused codes per client per window before that client is paused. */
  readonly invalidAttemptsMax: number;
  readonly invalidAttemptsWindowMs: number;
}

const REQUEST_SCOPE = 'pair_request';
const INVALID_SCOPE = 'pair_invalid';
const MINUTE_MS = 60_000;

const secondsUntil = (resetAt: Date, now: Date) => Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));

/**
 * Abuse limits of the unauthenticated pairing endpoint, persisted so that a
 * restart or a second API instance does not reset them (ADR-046). Every
 * window ends on its own: no client is locked out for good.
 */
export class PairingThrottle {
  constructor(
    private readonly store: RateLimitStore,
    private readonly limits: PairingThrottleLimits,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Counts the request; refuses it when either the request or the refused-code budget is spent. */
  async admit(client: string): Promise<void> {
    const now = this.clock();
    const requests = await this.store.hit(REQUEST_SCOPE, client, MINUTE_MS, now);
    if (requests.hits > this.limits.requestsPerMinute) throw new TooManyRequestsError(PAIRING_ATTEMPTS_LIMIT_MESSAGE, secondsUntil(requests.resetAt, now));
    const invalid = await this.store.peek(INVALID_SCOPE, client, now);
    if (invalid && invalid.hits >= this.limits.invalidAttemptsMax) throw new TooManyRequestsError(PAIRING_ATTEMPTS_LIMIT_MESSAGE, secondsUntil(invalid.resetAt, now));
  }

  /** Records a refused code; returns how many this client has in the current window. */
  async recordRejection(client: string): Promise<number> {
    return (await this.store.hit(INVALID_SCOPE, client, this.limits.invalidAttemptsWindowMs, this.clock())).hits;
  }
}
