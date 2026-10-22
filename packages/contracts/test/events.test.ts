import { describe, expect, it } from 'vitest';
import { EventListQuerySchema, IngestEventsRequestSchema } from '../src/index.js';

const HOST = '0b6c2f1e-0000-4000-8000-000000000001';

describe('IngestEventsRequestSchema', () => {
  it('accepts 1 to 100 events and nothing else in the envelope', () => {
    expect(IngestEventsRequestSchema.safeParse({ events: [{}] }).success).toBe(true);
    expect(IngestEventsRequestSchema.safeParse({ events: Array.from({ length: 100 }, () => ({})) }).success).toBe(true);
    expect(IngestEventsRequestSchema.safeParse({ events: [] }).success).toBe(false);
    expect(IngestEventsRequestSchema.safeParse({ events: Array.from({ length: 101 }, () => ({})) }).success).toBe(false);
    expect(IngestEventsRequestSchema.safeParse({ events: {} }).success).toBe(false);
    expect(IngestEventsRequestSchema.safeParse({ events: [{}], hostId: HOST }).success).toBe(false);
  });
});

describe('EventListQuerySchema', () => {
  it('parses filters with RFC 3339 range', () => {
    expect(EventListQuerySchema.parse({ hostId: HOST, category: 'NETWORK', eventType: 'NETWORK_LISTEN', from: '2026-05-01T00:00:00Z', to: '2026-05-02T00:00:00-03:00' })).toEqual({
      page: 1,
      pageSize: 20,
      hostId: HOST,
      category: 'NETWORK',
      eventType: 'NETWORK_LISTEN',
      from: '2026-05-01T00:00:00Z',
      to: '2026-05-02T00:00:00-03:00',
    });
  });

  it.each([
    [{ hostId: 'host-1' }, 'hostId'],
    [{ category: 'FILE' }, 'category'],
    [{ eventType: 'ALERT' }, 'eventType'],
    [{ from: 'ontem' }, 'from'],
    [{ from: '2026-05-02T00:00:00Z', to: '2026-05-01T00:00:00Z' }, 'to'],
    [{ category: 'PROCESS', eventType: 'NETWORK_LISTEN' }, 'eventType'],
  ])('rejects %j', (query, field) => {
    const result = EventListQuerySchema.safeParse(query);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))).toEqual([field]);
  });
});
