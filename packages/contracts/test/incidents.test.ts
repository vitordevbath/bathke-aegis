import { describe, expect, it } from 'vitest';
import { CreateIncidentRequestSchema, IncidentListQuerySchema, UpdateIncidentRequestSchema } from '../src/index.js';

const HOST_1 = '0b6c2f1e-0000-4000-8000-000000000001';
const HOST_2 = '0b6c2f1e-0000-4000-8000-000000000002';
const RULE = '0b6c2f1e-0000-4000-8000-000000000101';
const valid = { title: ' Shell inesperado no servidor web ', severity: 'HIGH', hostIds: [HOST_1] };

const fieldsOf = (schema: typeof CreateIncidentRequestSchema | typeof UpdateIncidentRequestSchema, input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => (issue.code === 'unrecognized_keys' ? issue.keys.join(',') : issue.path.join('.')));
};

describe('CreateIncidentRequestSchema', () => {
  it('trims, nulls an empty description and defaults related rules to none', () => {
    expect(CreateIncidentRequestSchema.parse({ ...valid, description: '  ' })).toEqual({
      title: 'Shell inesperado no servidor web',
      description: null,
      severity: 'HIGH',
      hostIds: [HOST_1],
      detectionRuleIds: [],
    });
  });

  it('requires at least one host and rejects duplicates and malformed ids', () => {
    expect(fieldsOf(CreateIncidentRequestSchema, { title: 'Título', severity: 'LOW' })).toEqual(['hostIds']);
    expect(fieldsOf(CreateIncidentRequestSchema, { ...valid, hostIds: [] })).toEqual(['hostIds']);
    expect(fieldsOf(CreateIncidentRequestSchema, { ...valid, hostIds: [HOST_1, HOST_1], detectionRuleIds: [RULE, RULE] })).toEqual([
      'hostIds',
      'detectionRuleIds',
    ]);
    expect(fieldsOf(CreateIncidentRequestSchema, { ...valid, detectionRuleIds: ['nope'] })).toEqual(['detectionRuleIds.0']);
  });

  it('accepts several hosts and rules', () => {
    expect(CreateIncidentRequestSchema.parse({ ...valid, hostIds: [HOST_1, HOST_2], detectionRuleIds: [RULE] }).hostIds).toHaveLength(2);
  });

  it('refuses server-owned fields: status, origin, resolvedAt, ids and timestamps', () => {
    const owned = { status: 'CLOSED', origin: 'DETECTION_ENGINE', resolvedAt: 'x', id: HOST_1, workspaceId: HOST_1, createdAt: 'x', updatedAt: 'x' };
    expect(fieldsOf(CreateIncidentRequestSchema, { ...valid, ...owned })).toEqual(['status,origin,resolvedAt,id,workspaceId,createdAt,updatedAt']);
  });

  it('bounds title and description', () => {
    expect(fieldsOf(CreateIncidentRequestSchema, { ...valid, title: 'x', description: 'x'.repeat(5001) })).toEqual(['title', 'description']);
  });
});

describe('UpdateIncidentRequestSchema', () => {
  it('accepts an optional lifecycle status but never the origin', () => {
    expect(UpdateIncidentRequestSchema.parse({ ...valid, status: 'RESOLVED' }).status).toBe('RESOLVED');
    expect(UpdateIncidentRequestSchema.parse(valid).status).toBeUndefined();
    expect(fieldsOf(UpdateIncidentRequestSchema, { ...valid, status: 'ARCHIVED' })).toEqual(['status']);
    expect(fieldsOf(UpdateIncidentRequestSchema, { ...valid, origin: 'MANUAL' })).toEqual(['origin']);
  });
});

describe('IncidentListQuerySchema', () => {
  it('parses filters and rejects unknown values', () => {
    expect(IncidentListQuerySchema.parse({ q: ' shell ', severity: 'HIGH', status: 'OPEN', origin: 'MANUAL' })).toEqual({
      page: 1,
      pageSize: 20,
      q: 'shell',
      severity: 'HIGH',
      status: 'OPEN',
      origin: 'MANUAL',
    });
    expect(IncidentListQuerySchema.safeParse({ status: 'DONE' }).success).toBe(false);
    expect(IncidentListQuerySchema.safeParse({ origin: 'AI' }).success).toBe(false);
  });
});
