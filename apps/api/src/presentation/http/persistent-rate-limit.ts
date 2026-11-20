import { createHash } from 'node:crypto';
import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import type { RateLimitStore } from '../../application/ports/rate-limit-store.js';

/** Counters of the routes limited through `@fastify/rate-limit` all live under this prefix. */
const SCOPE_PREFIX = 'http:';
/** `rate_limit_counters.scope` is VARCHAR(32). */
const SCOPE_LENGTH = 32;

interface RouteInfo {
  readonly method?: string | readonly string[];
  readonly url?: string;
}

/**
 * Stable, short scope per route (`http:` + a digest of method and path pattern), so login, register,
 * ingestion and heartbeat keep separate counters, as they did in memory.
 */
export function routeScope(routeInfo: RouteInfo | undefined): string {
  const method = Array.isArray(routeInfo?.method) ? routeInfo.method.join(',') : (routeInfo?.method ?? '*');
  const digest = createHash('sha256').update(`${method} ${routeInfo?.url ?? '*'}`).digest('hex');
  return `${SCOPE_PREFIX}${digest}`.slice(0, SCOPE_LENGTH);
}

/**
 * `@fastify/rate-limit` store backed by the persistent fixed-window counters of ADR-046 (MySQL in
 * production). Every per-route limit (login, register, ingestion, heartbeat) is then shared by all
 * API instances and survives a restart (ADR-051). The key the plugin passes is the client address
 * (`request.ip`, trusted only from Nginx); the store keeps only its keyed hash.
 */
export function persistentRateLimitStore(counters: RateLimitStore, clock: () => Date = () => new Date()): FastifyRateLimitStoreCtor {
  class PersistentStore {
    constructor(
      _options: unknown,
      private readonly scope: string = `${SCOPE_PREFIX}global`,
    ) {}

    incr(key: string, callback: (error: Error | null, result?: { current: number; ttl: number }) => void, timeWindow: number): void {
      const now = clock();
      counters.hit(this.scope, key, timeWindow, now).then(
        (count) => callback(null, { current: count.hits, ttl: Math.max(0, count.resetAt.getTime() - now.getTime()) }),
        (error: unknown) => callback(error instanceof Error ? error : new Error('rate limit store failed')),
      );
    }

    // The plugin passes the merged route limit options, with the route under `routeInfo` (its own
    // RedisStore reads it the same way); the published type names a different shape.
    child(routeOptions: unknown): FastifyRateLimitStore {
      const routeInfo = typeof routeOptions === 'object' && routeOptions !== null ? (routeOptions as { routeInfo?: RouteInfo }).routeInfo : undefined;
      return new PersistentStore(undefined, routeScope(routeInfo)) as unknown as FastifyRateLimitStore;
    }
  }
  return PersistentStore as unknown as FastifyRateLimitStoreCtor;
}
