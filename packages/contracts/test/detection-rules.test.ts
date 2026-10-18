import { describe, expect, it } from 'vitest';
import { DetectionRuleListQuerySchema, DetectionRuleRequestSchema } from '../src/index.js';

const HOST = '0b6c2f1e-0000-4000-8000-000000000001';
const valid = {
  name: 'Shell iniciado por servidor web',
  severity: 'HIGH',
  eventCategory: 'PROCESS',
  scope: 'ALL_HOSTS',
  definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'IN', value: [' bash ', 'sh'] }] },
};
const fieldsOf = (input: unknown) => {
  const result = DetectionRuleRequestSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('DetectionRuleRequestSchema', () => {
  it('defaults enabled/hostIds, nulls an empty description and normalizes the definition', () => {
    expect(DetectionRuleRequestSchema.parse({ ...valid, description: ' ' })).toEqual({
      ...valid,
      description: null,
      enabled: true,
      hostIds: [],
      definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'IN', value: ['bash', 'sh'] }] },
    });
  });

  it('reports definition issues on precise paths', () => {
    expect(fieldsOf({ ...valid, eventCategory: 'SYSTEM' })).toEqual(['definition.conditions.0.field']);
  });

  it('enforces scope/target consistency', () => {
    expect(fieldsOf({ ...valid, scope: 'SELECTED_HOSTS' })).toEqual(['hostIds']);
    expect(fieldsOf({ ...valid, hostIds: [HOST] })).toEqual(['hostIds']);
    expect(fieldsOf({ ...valid, scope: 'SELECTED_HOSTS', hostIds: [HOST, HOST] })).toEqual(['hostIds']);
    expect(fieldsOf({ ...valid, scope: 'SELECTED_HOSTS', hostIds: ['not-a-uuid'] })).toEqual(['hostIds.0']);
  });

  it('rejects mass assignment of server-controlled fields', () => {
    const result = DetectionRuleRequestSchema.safeParse({ ...valid, workspaceId: HOST, id: HOST, createdAt: 'x' });
    expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['workspaceId', 'id', 'createdAt'] });
  });

  it('rejects invalid enums', () => {
    expect(fieldsOf({ ...valid, severity: 'URGENT', eventCategory: 'FILE', scope: 'SOME' }).slice(0, 3)).toEqual(['severity', 'eventCategory', 'scope']);
  });
});

describe('DetectionRuleListQuerySchema', () => {
  it('parses the optional filters on top of the generic pagination', () => {
    expect(DetectionRuleListQuerySchema.parse({ page: '2', severity: 'LOW', enabled: 'false', eventCategory: 'NETWORK', q: ' ssh ' })).toEqual({
      page: 2,
      pageSize: 20,
      severity: 'LOW',
      enabled: false,
      eventCategory: 'NETWORK',
      q: 'ssh',
    });
    expect(DetectionRuleListQuerySchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });
});
