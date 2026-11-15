import { createHmac, hkdfSync } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { RateLimitCount, RateLimitStore } from '../../application/ports/rate-limit-store.js';
import type { Database } from './client.js';
import { rateLimitCounters } from './schema.js';

/**
 * Derives the key that hashes rate-limit subjects from the server secret, with
 * its own label so it is never the JWT signing key itself. Every instance
 * sharing the secret computes the same hashes; an IPv4 address (2^32 values)
 * hashed without a key could be reversed by enumeration.
 */
export function rateLimitSubjectKey(serverSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', serverSecret, Buffer.alloc(0), 'aegis/rate-limit-subject/v1', 32));
}

/**
 * MySQL-backed counters (ADR-046). `hit` is one upsert plus a read of the
 * same row inside a transaction: the upsert takes the row's exclusive lock,
 * so concurrent hits serialize and each one reads its own count.
 */
export class DrizzleRateLimitStore implements RateLimitStore {
  constructor(
    private readonly db: Database,
    private readonly subjectKey: Buffer,
  ) {}

  async hit(scope: string, subject: string, windowMs: number, now: Date): Promise<RateLimitCount> {
    const subjectHash = this.hashOf(scope, subject);
    const windowEnd = new Date(now.getTime() + windowMs);
    return this.db.transaction(async (tx) => {
      await tx
        .insert(rateLimitCounters)
        .values({ scope, subjectHash, hits: 1, windowExpiresAt: windowEnd })
        .onDuplicateKeyUpdate({
          // Both conditions read the row's previous window end: `hits` is assigned first and does not change it.
          set: {
            hits: sql`IF(${rateLimitCounters.windowExpiresAt} <= ${now}, 1, ${rateLimitCounters.hits} + 1)`,
            windowExpiresAt: sql`IF(${rateLimitCounters.windowExpiresAt} <= ${now}, ${windowEnd}, ${rateLimitCounters.windowExpiresAt})`,
          },
        });
      const [row] = await tx
        .select({ hits: rateLimitCounters.hits, resetAt: rateLimitCounters.windowExpiresAt })
        .from(rateLimitCounters)
        .where(and(eq(rateLimitCounters.scope, scope), eq(rateLimitCounters.subjectHash, subjectHash)));
      if (!row) throw new Error('rate limit counter vanished inside its transaction');
      return row;
    });
  }

  async peek(scope: string, subject: string, now: Date): Promise<RateLimitCount | null> {
    const [row] = await this.db
      .select({ hits: rateLimitCounters.hits, resetAt: rateLimitCounters.windowExpiresAt })
      .from(rateLimitCounters)
      .where(and(eq(rateLimitCounters.scope, scope), eq(rateLimitCounters.subjectHash, this.hashOf(scope, subject)), gt(rateLimitCounters.windowExpiresAt, now)));
    return row ?? null;
  }

  async purgeExpired(now: Date, limit: number): Promise<number> {
    const [result] = await this.db.delete(rateLimitCounters).where(lt(rateLimitCounters.windowExpiresAt, now)).limit(limit);
    return result.affectedRows;
  }

  private hashOf(scope: string, subject: string): string {
    return createHmac('sha256', this.subjectKey).update(`${scope}\n${subject}`, 'utf8').digest('hex');
  }
}
