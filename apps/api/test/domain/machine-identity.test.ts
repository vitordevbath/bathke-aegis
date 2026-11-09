import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialRevokedError, PAIRING_POLICY, PairingRejectedError, ValidationError, type MachineScope } from '@aegis/domain';
import { PairingChallenge } from '../../src/domain/pairing-challenge.js';
import { MachineCredential, type MachineCredentialSnapshot } from '../../src/domain/machine-credential.js';
import { Host } from '../../src/domain/host.js';

const NOW = new Date('2026-05-01T12:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
const HASH = 'a'.repeat(64);

const challenge = () => PairingChallenge.issue({ workspaceId: randomUUID(), hostId: randomUUID(), codeHash: HASH, createdBy: randomUUID() }, NOW);
const credential = () => MachineCredential.issue({ workspaceId: randomUUID(), hostId: randomUUID(), tokenHash: HASH, scopes: ['events:ingest'] }, NOW);

const rejection = (action: () => void) => {
  try {
    action();
  } catch (error) {
    return error as PairingRejectedError;
  }
  throw new Error('expected a rejection');
};

describe('PairingChallenge', () => {
  it('starts pending, bound to its host, and expires after the central TTL', () => {
    const issued = challenge();
    expect(issued.statusAt(NOW)).toBe('PENDING');
    expect(issued.expiresAt).toEqual(later(PAIRING_POLICY.codeTtlMs));
    expect(issued.toSnapshot()).toMatchObject({ codeHash: HASH, consumedAt: null, revokedAt: null });
  });

  it('is expired exactly at its expiry instant', () => {
    const issued = challenge();
    expect(issued.statusAt(later(PAIRING_POLICY.codeTtlMs - 1))).toBe('PENDING');
    expect(issued.statusAt(later(PAIRING_POLICY.codeTtlMs))).toBe('EXPIRED');
  });

  it('can be consumed once; reuse is refused as CONSUMED', () => {
    const issued = challenge();
    issued.consume(later(1000));
    expect(issued.toSnapshot().consumedAt).toEqual(later(1000));
    expect(issued.statusAt(later(2000))).toBe('CONSUMED');
    expect(rejection(() => issued.consume(later(2000))).reason).toBe('CONSUMED');
  });

  it('refuses an expired code without changing it, and reports internal ids for audit only', () => {
    const issued = challenge();
    const error = rejection(() => issued.consume(later(PAIRING_POLICY.codeTtlMs + 1)));
    expect(error).toBeInstanceOf(PairingRejectedError);
    expect(error.reason).toBe('EXPIRED');
    expect(error.audit).toEqual({ challengeId: issued.id, workspaceId: issued.workspaceId, hostId: issued.hostId });
    expect(error.message).not.toContain(issued.id);
    expect(issued.toSnapshot().consumedAt).toBeNull();
  });

  it('refuses a revoked code, and a consumed one keeps its history when revoked later', () => {
    const revoked = challenge();
    revoked.revoke(later(1));
    expect(rejection(() => revoked.consume(later(2))).reason).toBe('REVOKED');

    const consumed = challenge();
    consumed.consume(later(1));
    consumed.revoke(later(2));
    expect(consumed.toSnapshot().revokedAt).toBeNull();
    expect(consumed.statusAt(later(3))).toBe('CONSUMED');
  });

  it('keeps the first revocation time', () => {
    const issued = challenge();
    issued.revoke(later(1));
    issued.revoke(later(2));
    expect(issued.toSnapshot().revokedAt).toEqual(later(1));
  });

  it('survives a snapshot round-trip', () => {
    const issued = challenge();
    issued.revoke(later(1));
    expect(PairingChallenge.restore(issued.toSnapshot()).toSnapshot()).toEqual(issued.toSnapshot());
  });
});

describe('MachineCredential', () => {
  it('holds a hash, a prefix derived from its id, and validated scopes', () => {
    const issued = credential();
    const snapshot = issued.toSnapshot();
    expect(issued.isActive).toBe(true);
    expect(snapshot.tokenHash).toBe(HASH);
    expect(snapshot.tokenPrefix).toBe(`aegis_agent_${issued.id.replaceAll('-', '').slice(0, 8)}`);
    expect(snapshot.scopes).toEqual(['events:ingest']);
    expect(snapshot).toMatchObject({ lastUsedAt: null, revokedAt: null, pairingChallengeId: null, rotatedFromCredentialId: null });
  });

  it.each([
    ['empty', []],
    ['unknown', ['hosts:write']],
    ['repeated', ['events:ingest', 'events:ingest']],
  ])('refuses a %s scope set at issue and at restore', (_case, scopes) => {
    const invalid = scopes as MachineScope[];
    expect(() => MachineCredential.issue({ workspaceId: 'w', hostId: 'h', tokenHash: HASH, scopes: invalid })).toThrow(ValidationError);
    const stored: MachineCredentialSnapshot = { ...credential().toSnapshot(), scopes: invalid };
    expect(() => MachineCredential.restore(stored)).toThrow(ValidationError);
  });

  it('revocation is final and idempotent, keeping the first time', () => {
    const issued = credential();
    expect(issued.revoke(later(1))).toBe(true);
    expect(issued.revoke(later(2))).toBe(false);
    expect(issued.isActive).toBe(false);
    expect(issued.toSnapshot().revokedAt).toEqual(later(1));
  });

  it('rotation revokes the original and links a successor on the same host and workspace', () => {
    const original = credential();
    const successor = original.rotate('b'.repeat(64), later(5));
    expect(original.isActive).toBe(false);
    expect(original.toSnapshot().revokedAt).toEqual(later(5));
    expect(successor.id).not.toBe(original.id);
    expect(successor.isActive).toBe(true);
    expect(successor.toSnapshot()).toMatchObject({
      workspaceId: original.workspaceId,
      hostId: original.hostId,
      tokenHash: 'b'.repeat(64),
      scopes: ['events:ingest'],
      rotatedFromCredentialId: original.id,
      pairingChallengeId: null,
      createdAt: later(5),
    });
  });

  it('a revoked credential cannot be rotated', () => {
    const revoked = credential();
    revoked.revoke(later(1));
    expect(() => revoked.rotate('b'.repeat(64), later(2))).toThrow(CredentialRevokedError);
  });
});

describe('Host pairing state', () => {
  const host = () => Host.register({ workspaceId: randomUUID(), displayName: 'servidor' }, NOW);

  it('becomes PAIRED, never ONLINE, and follows the active credential', () => {
    const registered = host();
    registered.markPaired('c1', later(1));
    expect(registered.toSnapshot()).toMatchObject({ agentId: 'c1', connectionState: 'PAIRED', lastSeenAt: null, updatedAt: later(1) });
    expect(registered.isPaired).toBe(true);
    registered.markPaired('c2', later(2));
    expect(registered.toSnapshot()).toMatchObject({ agentId: 'c2', connectionState: 'PAIRED' });
  });

  it('goes back to UNPAIRED when its credential ends', () => {
    const registered = host();
    registered.markPaired('c1', later(1));
    registered.markUnpaired(later(2));
    expect(registered.toSnapshot()).toMatchObject({ agentId: null, connectionState: 'UNPAIRED' });
    expect(registered.isPaired).toBe(false);
  });

  it('leaves a heartbeat-owned state alone when the credential changes', () => {
    const online = Host.restore({ ...host().toSnapshot(), agentId: 'c1', connectionState: 'ONLINE' });
    online.markPaired('c2', later(1));
    expect(online.connectionState).toBe('ONLINE');
  });
});
