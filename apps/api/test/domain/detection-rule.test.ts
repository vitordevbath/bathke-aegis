import { describe, expect, it } from 'vitest';
import { ValidationError } from '@aegis/domain';
import { DetectionRule, type DetectionRuleDetails } from '../../src/domain/detection-rule.js';

const WORKSPACE = '0b6c2f1e-0000-4000-8000-0000000000aa';
const HOST_1 = '0b6c2f1e-0000-4000-8000-000000000001';
const HOST_2 = '0b6c2f1e-0000-4000-8000-000000000002';

const details = (overrides: Partial<DetectionRuleDetails> = {}): DetectionRuleDetails => ({
  name: 'Shell iniciado por servidor web',
  description: 'nginx gerando shell',
  severity: 'HIGH',
  enabled: true,
  eventCategory: 'PROCESS',
  scope: 'ALL_HOSTS',
  targetHostIds: [],
  definition: {
    version: 1,
    match: 'ALL',
    conditions: [
      { field: 'process.parentName', operator: 'EQUALS', value: 'nginx' },
      { field: 'process.name', operator: 'IN', value: ['bash', 'sh'] },
    ],
  },
  ...overrides,
});

const fieldsOf = (fn: () => unknown) => {
  try {
    fn();
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).issues.map((issue) => issue.field);
  }
};

describe('DetectionRule', () => {
  it('registers a valid rule with normalized fields', () => {
    const now = new Date('2026-04-01T00:00:00Z');
    const rule = DetectionRule.register(WORKSPACE, details({ name: '  Shell   web ', description: '  ' }), now);
    expect(rule.toSnapshot()).toMatchObject({
      workspaceId: WORKSPACE,
      name: 'Shell web',
      description: null,
      severity: 'HIGH',
      enabled: true,
      scope: 'ALL_HOSTS',
      targetHostIds: [],
      createdAt: now,
      updatedAt: now,
    });
    expect(rule.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['too short name', { name: 'A' }, ['name']],
    ['too long name', { name: 'x'.repeat(121) }, ['name']],
    ['too long description', { description: 'x'.repeat(1001) }, ['description']],
    ['invalid severity', { severity: 'URGENT' as never }, ['severity']],
    ['invalid category', { eventCategory: 'FILE' as never }, ['eventCategory']],
    ['invalid scope', { scope: 'SOME' as never }, ['scope']],
    ['empty conditions', { definition: { version: 1, match: 'ALL', conditions: [] } }, ['definition.conditions']],
    [
      'a field incompatible with the category',
      { eventCategory: 'NETWORK' as const },
      ['definition.conditions.0.field', 'definition.conditions.1.field'],
    ],
    [
      'an incompatible operator',
      { definition: { version: 1, match: 'ALL', conditions: [{ field: 'process.name', operator: 'LESS_THAN', value: 'a' }] } },
      ['definition.conditions.0.operator'],
    ],
    ['SELECTED_HOSTS without targets', { scope: 'SELECTED_HOSTS' as const }, ['hostIds']],
    ['ALL_HOSTS with targets', { targetHostIds: [HOST_1] }, ['hostIds']],
    ['duplicated targets', { scope: 'SELECTED_HOSTS' as const, targetHostIds: [HOST_1, HOST_1] }, ['hostIds']],
  ])('cannot be born with %s', (_case, overrides, fields) => {
    expect(fieldsOf(() => DetectionRule.register(WORKSPACE, details(overrides)))).toEqual(fields);
  });

  it('accepts SELECTED_HOSTS with several distinct targets', () => {
    const rule = DetectionRule.register(WORKSPACE, details({ scope: 'SELECTED_HOSTS', targetHostIds: [HOST_1, HOST_2] }));
    expect(rule.targetHostIds).toEqual([HOST_1, HOST_2]);
  });

  it('disabling keeps the definition; switching to ALL_HOSTS drops targets', () => {
    const rule = DetectionRule.register(WORKSPACE, details({ scope: 'SELECTED_HOSTS', targetHostIds: [HOST_1] }));
    const definition = rule.definition;
    rule.update(details({ enabled: false, scope: 'ALL_HOSTS', targetHostIds: [] }));

    expect(rule.enabled).toBe(false);
    expect(rule.definition).toEqual(definition);
    expect(rule.scope).toBe('ALL_HOSTS');
    expect(rule.targetHostIds).toEqual([]);
  });

  it('refuses to restore a persisted definition that no longer validates', () => {
    const snapshot = DetectionRule.register(WORKSPACE, details()).toSnapshot();
    expect(() => DetectionRule.restore({ ...snapshot, definition: { ...snapshot.definition, version: 9 as 1 } })).toThrow(ValidationError);
  });

  it('exposes no setters and keeps state runtime-private', () => {
    for (const field of ['workspaceId', 'name', 'enabled', 'scope', 'targetHostIds', 'definition']) {
      expect(Object.getOwnPropertyDescriptor(DetectionRule.prototype, field)?.set).toBeUndefined();
    }
    expect(Object.keys(DetectionRule.register(WORKSPACE, details()))).toEqual(['id']);
  });
});
