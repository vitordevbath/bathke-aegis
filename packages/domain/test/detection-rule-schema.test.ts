import { describe, expect, it } from 'vitest';
import { DETECTION_FIELDS, validateDetectionDefinition, type DefinitionValidation } from '../src/index.js';

const definition = (conditions: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, match: 'ALL', conditions, ...extra });
const issuesOf = (result: DefinitionValidation) => (result.ok ? [] : result.issues.map((issue) => issue.field));

describe('validateDetectionDefinition (schema v1)', () => {
  it('accepts a structured definition and normalizes string values', () => {
    const result = validateDetectionDefinition(
      'PROCESS',
      definition([
        { field: 'process.parentName', operator: 'EQUALS', value: ' nginx ' },
        { field: 'process.name', operator: 'IN', value: ['bash', 'sh'] },
      ]),
    );
    expect(result).toEqual({
      ok: true,
      definition: {
        version: 1,
        match: 'ALL',
        conditions: [
          { field: 'process.parentName', operator: 'EQUALS', value: 'nginx' },
          { field: 'process.name', operator: 'IN', value: ['bash', 'sh'] },
        ],
      },
    });
  });

  it('accepts ANY and integer fields with numeric operators', () => {
    const result = validateDetectionDefinition(
      'NETWORK',
      definition([{ field: 'network.remotePort', operator: 'GREATER_THAN', value: 1024 }], { match: 'ANY' }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['not an object', 'rm -rf /', ['definition']],
    ['unsupported version', { ...definition([{ field: 'process.name', operator: 'EQUALS', value: 'x' }]), version: 2 }, ['definition.version']],
    ['invalid match', { ...definition([{ field: 'process.name', operator: 'EQUALS', value: 'x' }]), match: 'NONE' }, ['definition.match']],
    ['empty conditions', definition([]), ['definition.conditions']],
    ['too many conditions', definition(Array.from({ length: 11 }, () => ({ field: 'process.name', operator: 'EQUALS', value: 'x' }))), ['definition.conditions']],
    ['extra top-level property (e.g. code)', definition([{ field: 'process.name', operator: 'EQUALS', value: 'x' }], { script: 'eval(1)' }), ['definition.script']],
  ])('rejects %s', (_case, raw, fields) => {
    expect(issuesOf(validateDetectionDefinition('PROCESS', raw))).toEqual(fields);
  });

  it.each([
    ['a field outside the allowlist', { field: 'process.commandLine', operator: 'EQUALS', value: 'x' }, 'field'],
    ['a field of another category', { field: 'network.remotePort', operator: 'EQUALS', value: 22 }, 'field'],
    ['an unknown operator (no regex)', { field: 'process.name', operator: 'MATCHES', value: '.*' }, 'operator'],
    ['a numeric operator on a text field', { field: 'process.name', operator: 'GREATER_THAN', value: 'a' }, 'operator'],
    ['a blank value', { field: 'process.name', operator: 'EQUALS', value: '   ' }, 'value'],
    ['a number for a text field', { field: 'process.name', operator: 'EQUALS', value: 1 }, 'value'],
    ['IN without a list', { field: 'process.name', operator: 'IN', value: 'bash' }, 'value'],
    ['IN with repeated values', { field: 'process.name', operator: 'IN', value: ['sh', 'sh'] }, 'value'],
    ['an extra property in a condition', { field: 'process.name', operator: 'EQUALS', value: 'x', code: '1' }, 'code'],
  ])('rejects a PROCESS condition with %s', (_case, condition, prop) => {
    expect(issuesOf(validateDetectionDefinition('PROCESS', definition([condition])))).toEqual([`definition.conditions.0.${prop}`]);
  });

  it.each([
    ['text for a port', 'http'],
    ['a port above 65535', 70_000],
    ['a fractional port', 22.5],
    ['a negative port', -1],
  ])('rejects %s', (_case, value) => {
    expect(issuesOf(validateDetectionDefinition('NETWORK', definition([{ field: 'network.localPort', operator: 'EQUALS', value }])))).toEqual([
      'definition.conditions.0.value',
    ]);
  });

  it('only offers fields of the planned telemetry contract, grouped by category', () => {
    expect(Object.keys(DETECTION_FIELDS)).toEqual(['PROCESS', 'NETWORK', 'SYSTEM']);
    for (const [category, fields] of Object.entries(DETECTION_FIELDS)) {
      for (const field of fields) expect(field.id.startsWith(`${category.toLowerCase()}.`)).toBe(true);
    }
  });
});
