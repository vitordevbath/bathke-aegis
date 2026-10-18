import { describe, expect, it } from 'vitest';
import { CreateHostRequestSchema, HostListQuerySchema, PaginationQuerySchema, UpdateHostRequestSchema } from '../src/index.js';

const fieldsOf = (result: { error?: { issues: { path: (string | number)[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('PaginationQuerySchema', () => {
  it('defaults to page 1 and 20 items', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces query-string numbers', () => {
    expect(PaginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  it.each([
    [{ page: '0' }, ['page']],
    [{ page: '-1' }, ['page']],
    [{ page: '1.5' }, ['page']],
    [{ page: 'abc' }, ['page']],
    [{ pageSize: '0' }, ['pageSize']],
    [{ pageSize: '101' }, ['pageSize']],
  ])('rejects %j', (query, fields) => {
    expect(fieldsOf(PaginationQuerySchema.safeParse(query))).toEqual(fields);
  });
});

describe('HostListQuerySchema', () => {
  it('trims the search and drops it when blank', () => {
    expect(HostListQuerySchema.parse({ q: '  servidor ' }).q).toBe('servidor');
    expect(HostListQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });
});

describe('Create/UpdateHostRequestSchema', () => {
  it('trims fields and turns an empty description into null', () => {
    expect(CreateHostRequestSchema.parse({ displayName: '  Servidor  ', description: '  ' })).toEqual({
      displayName: 'Servidor',
      description: null,
    });
    expect(UpdateHostRequestSchema.parse({ displayName: 'Servidor' })).toEqual({ displayName: 'Servidor', description: null });
  });

  it('requires a display name of 2–120 characters and limits the description', () => {
    expect(fieldsOf(CreateHostRequestSchema.safeParse({}))).toEqual(['displayName']);
    expect(fieldsOf(CreateHostRequestSchema.safeParse({ displayName: 'A' }))).toEqual(['displayName']);
    expect(fieldsOf(CreateHostRequestSchema.safeParse({ displayName: 'x'.repeat(121) }))).toEqual(['displayName']);
    expect(fieldsOf(CreateHostRequestSchema.safeParse({ displayName: 'Servidor', description: 'x'.repeat(501) }))).toEqual(['description']);
  });

  it('rejects system-controlled fields (no mass assignment)', () => {
    const result = UpdateHostRequestSchema.safeParse({
      displayName: 'Servidor',
      workspaceId: 'other',
      agentId: 'fake-agent',
      hostname: 'spoofed',
      connectionState: 'ONLINE',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: ['workspaceId', 'agentId', 'hostname', 'connectionState'],
    });
  });
});
