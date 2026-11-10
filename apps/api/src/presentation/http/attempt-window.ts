/**
 * Counts failures per key in a fixed window that expires on its own, so a
 * pause is always temporary and a shared address cannot be locked out for
 * good. In memory, like the rate limiter: one API instance, reset on restart.
 */
export class AttemptWindow {
  readonly #attempts = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True while this key has used up its failures for the current window. */
  isExhausted(key: string): boolean {
    return this.current(key) >= this.max;
  }

  /** Records a failure and returns how many this key has in the window. */
  record(key: string): number {
    const count = this.current(key) + 1;
    const entry = this.#attempts.get(key);
    if (entry) {
      entry.count = count;
      return count;
    }
    // Insertion order makes the first key the oldest; evicting it bounds memory under address churn.
    if (this.#attempts.size >= this.maxKeys) {
      const oldest = this.#attempts.keys().next().value;
      if (oldest !== undefined) this.#attempts.delete(oldest);
    }
    this.#attempts.set(key, { count, expiresAt: this.now() + this.windowMs });
    return count;
  }

  private current(key: string): number {
    const entry = this.#attempts.get(key);
    if (!entry) return 0;
    if (this.now() >= entry.expiresAt) {
      this.#attempts.delete(key);
      return 0;
    }
    return entry.count;
  }
}
