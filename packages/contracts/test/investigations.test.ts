import { describe, expect, it } from 'vitest';
import { CreateInvestigationRequestSchema, InvestigationListQuerySchema, UpdateInvestigationRequestSchema } from '../src/index.js';

const INCIDENT_1 = '0b6c2f1e-0000-4000-8000-000000000201';
const INCIDENT_2 = '0b6c2f1e-0000-4000-8000-000000000202';
const valid = { title: ' Atividade incomum nos servidores web ', incidentIds: [INCIDENT_1] };

const fieldsOf = (schema: typeof CreateInvestigationRequestSchema | typeof UpdateInvestigationRequestSchema, input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => (issue.code === 'unrecognized_keys' ? issue.keys.join(',') : issue.path.join('.')));
};

describe('CreateInvestigationRequestSchema', () => {
  it('trims and nulls an empty description', () => {
    expect(CreateInvestigationRequestSchema.parse({ ...valid, description: '  ' })).toEqual({
      title: 'Atividade incomum nos servidores web',
      description: null,
      incidentIds: [INCIDENT_1],
    });
  });

  it('requires at least one incident and rejects duplicates and malformed ids', () => {
    expect(fieldsOf(CreateInvestigationRequestSchema, { title: 'Título' })).toEqual(['incidentIds']);
    expect(fieldsOf(CreateInvestigationRequestSchema, { ...valid, incidentIds: [] })).toEqual(['incidentIds']);
    expect(fieldsOf(CreateInvestigationRequestSchema, { ...valid, incidentIds: [INCIDENT_1, INCIDENT_1] })).toEqual(['incidentIds']);
    expect(fieldsOf(CreateInvestigationRequestSchema, { ...valid, incidentIds: ['nope'] })).toEqual(['incidentIds.0']);
    expect(CreateInvestigationRequestSchema.parse({ ...valid, incidentIds: [INCIDENT_1, INCIDENT_2] }).incidentIds).toHaveLength(2);
  });

  it('refuses server-owned fields: status, conclusion, closedAt, ids and timestamps', () => {
    const owned = { status: 'CLOSED', conclusion: 'x', closedAt: 'x', id: INCIDENT_1, workspaceId: INCIDENT_1, createdAt: 'x', updatedAt: 'x' };
    expect(fieldsOf(CreateInvestigationRequestSchema, { ...valid, ...owned })).toEqual(['status,conclusion,closedAt,id,workspaceId,createdAt,updatedAt']);
  });

  it('bounds title and description', () => {
    expect(fieldsOf(CreateInvestigationRequestSchema, { ...valid, title: 'x', description: 'x'.repeat(5001) })).toEqual(['title', 'description']);
  });
});

describe('UpdateInvestigationRequestSchema', () => {
  it('accepts a draft conclusion and an optional status, never closedAt', () => {
    expect(UpdateInvestigationRequestSchema.parse({ ...valid, conclusion: ' Rascunho ', status: 'IN_PROGRESS' })).toMatchObject({ conclusion: 'Rascunho', status: 'IN_PROGRESS' });
    const draft = UpdateInvestigationRequestSchema.parse({ ...valid, conclusion: '' });
    expect([draft.conclusion, draft.status]).toEqual([null, undefined]);
    expect(fieldsOf(UpdateInvestigationRequestSchema, { ...valid, status: 'RESOLVED' })).toEqual(['status']);
    expect(fieldsOf(UpdateInvestigationRequestSchema, { ...valid, conclusion: 'x'.repeat(10001) })).toEqual(['conclusion']);
    expect(fieldsOf(UpdateInvestigationRequestSchema, { ...valid, closedAt: '2026-01-01T00:00:00Z' })).toEqual(['closedAt']);
  });

  it('leaves the "close needs a conclusion" rule to the domain', () => {
    expect(UpdateInvestigationRequestSchema.safeParse({ ...valid, status: 'CLOSED' }).success).toBe(true);
  });
});

describe('InvestigationListQuerySchema', () => {
  it('parses filters and rejects unknown statuses', () => {
    expect(InvestigationListQuerySchema.parse({ q: ' web ', status: 'IN_PROGRESS' })).toEqual({ page: 1, pageSize: 20, q: 'web', status: 'IN_PROGRESS' });
    expect(InvestigationListQuerySchema.safeParse({ status: 'INVESTIGATING' }).success).toBe(false);
  });
});
