export interface RateLimitCount {
  /** Hits in the current window, including the one just counted. */
  readonly hits: number;
  /** When the current window ends and the count starts over. */
  readonly resetAt: Date;
}

/**
 * Fixed-window counters shared by every API instance and kept across restarts
 * (ADR-046). A `subject` (e.g. a client address) is never stored as given:
 * implementations keep only a keyed hash of it.
 */
export interface RateLimitStore {
  /** Counts one hit atomically. A window that has ended starts over at 1. */
  hit(scope: string, subject: string, windowMs: number, now: Date): Promise<RateLimitCount>;
  /** The current window's count without adding to it; null when there is none. */
  peek(scope: string, subject: string, now: Date): Promise<RateLimitCount | null>;
  /** Removes at most `limit` counters whose window ended before `now`; returns how many. */
  purgeExpired(now: Date, limit: number): Promise<number>;
}
