import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  ForbiddenError,
  InvalidStateError,
  CredentialRevokedError,
  HostAlreadyPairedError,
  MACHINE_SCOPES,
  MachineAuthenticationError,
  MachineScopeError,
  PAIRING_POLICY,
  PAIRING_REJECTED_MESSAGE,
  PairingRejectedError,
  ValidationError,
  formatMachineToken,
  formatPairingCode,
  isMachineScope,
  isPairingCodeFormat,
  machineTokenPrefixOf,
  parseMachineScopes,
  parseMachineToken,
} from '../src/index.js';

const ID = '1a2b3c4d-5e6f-4a1b-8c2d-0123456789ab';
const SECRET = 'A'.repeat(21) + '-_' + 'z'.repeat(20);

describe('machine scopes', () => {
  it('exposes only the capability that exists today', () => {
    expect(MACHINE_SCOPES).toEqual(['events:ingest']);
    expect(isMachineScope('events:ingest')).toBe(true);
    expect(isMachineScope('hosts:write')).toBe(false);
    expect(isMachineScope(1)).toBe(false);
  });

  it('accepts a valid set and returns a copy', () => {
    const raw = ['events:ingest'];
    const parsed = parseMachineScopes(raw);
    expect(parsed).toEqual(raw);
    expect(parsed).not.toBe(raw);
  });

  it.each([
    ['empty', []],
    ['unknown', ['events:ingest', 'admin']],
    ['repeated', ['events:ingest', 'events:ingest']],
    ['not a list', 'events:ingest'],
    ['null', null],
  ])('fails closed on a %s set', (_case, raw) => {
    expect(() => parseMachineScopes(raw)).toThrow(ValidationError);
  });
});

describe('pairing code format', () => {
  it('accepts exactly prefix + 43 base64url characters', () => {
    expect(isPairingCodeFormat(formatPairingCode(SECRET))).toBe(true);
  });

  it.each([
    ['short', formatPairingCode('A'.repeat(42))],
    ['long', formatPairingCode('A'.repeat(44))],
    ['wrong prefix', `aegis_pairs_${SECRET}`],
    ['no prefix', SECRET],
    ['invalid character', formatPairingCode(`${'A'.repeat(42)}.`)],
    ['trailing newline', `${formatPairingCode(SECRET)}\n`],
    ['machine token', formatMachineToken(ID, SECRET)],
  ])('refuses a %s value', (_case, value) => {
    expect(isPairingCodeFormat(value)).toBe(false);
  });

  it('allows 10 minutes by default', () => {
    expect(PAIRING_POLICY.codeTtlMs).toBe(600_000);
  });
});

describe('machine token format', () => {
  it('round-trips the public id and the secret', () => {
    const token = formatMachineToken(ID, SECRET);
    expect(token).toBe(`aegis_agent_1a2b3c4d5e6f4a1b8c2d0123456789ab.${SECRET}`);
    expect(parseMachineToken(token)).toEqual({ credentialId: ID, secret: SECRET });
  });

  it('is structurally different from a JWT (two segments, fixed prefix)', () => {
    expect(formatMachineToken(ID, SECRET).split('.')).toHaveLength(2);
    expect(parseMachineToken('aaa.bbb.ccc')).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['no secret', 'aegis_agent_1a2b3c4d5e6f4a1b8c2d0123456789ab.'],
    ['no separator', `aegis_agent_1a2b3c4d5e6f4a1b8c2d0123456789ab${SECRET}`],
    ['short id', `aegis_agent_1a2b.${SECRET}`],
    ['uppercase id', `aegis_agent_1A2B3C4D5E6F4A1B8C2D0123456789AB.${SECRET}`],
    ['extra segment', `aegis_agent_1a2b3c4d5e6f4a1b8c2d0123456789ab.${SECRET}.x`],
    ['pairing code', formatPairingCode(SECRET)],
  ])('returns null for %s', (_case, raw) => {
    expect(parseMachineToken(raw)).toBeNull();
  });

  it('refuses to format an id that is not a UUID', () => {
    expect(() => formatMachineToken('abc', SECRET)).toThrow(ValidationError);
  });

  it('derives the administrative prefix from the public id only', () => {
    const prefix = machineTokenPrefixOf(ID);
    expect(prefix).toBe('aegis_agent_1a2b3c4d');
    expect(prefix).not.toContain(SECRET.slice(0, 4));
  });
});

describe('machine identity errors', () => {
  it('pairing rejections share one message and keep the reason internal', () => {
    for (const reason of ['UNKNOWN_CODE', 'EXPIRED', 'CONSUMED', 'REVOKED'] as const) {
      const error = new PairingRejectedError(reason, { challengeId: ID });
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.message).toBe(PAIRING_REJECTED_MESSAGE);
      expect(error.message).not.toContain(reason);
      expect(error.message).not.toContain(ID);
    }
  });

  it('machine authentication failures are generic 401-class errors', () => {
    const error = new MachineAuthenticationError('REVOKED', ID);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.message).toBe(new AuthenticationError().message);
    expect(error.credentialId).toBe(ID);
  });

  it('classifies scope and state failures', () => {
    expect(new MachineScopeError('events:ingest')).toBeInstanceOf(ForbiddenError);
    expect(new HostAlreadyPairedError()).toBeInstanceOf(InvalidStateError);
    expect(new CredentialRevokedError()).toBeInstanceOf(InvalidStateError);
  });
});
