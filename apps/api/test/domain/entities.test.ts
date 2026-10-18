import { describe, expect, it } from 'vitest';
import { Cpf, Email, ValidationError } from '@aegis/domain';
import { User } from '../../src/domain/user.js';
import { Workspace } from '../../src/domain/workspace.js';
import { Membership } from '../../src/domain/membership.js';

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZS1zYWx0$ZmFrZS1oYXNo';

const newUser = (name = '  Ana   Teste ') =>
  User.register({ name, email: Email.create('ANA@EXAMPLE.COM'), cpf: Cpf.create('123.456.789-09'), passwordHash: FAKE_HASH });

describe('User', () => {
  it('registers with a UUID, normalized fields and timestamps', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const user = User.register(
      { name: 'Ana Teste', email: Email.create('Ana@Example.com'), cpf: Cpf.create('123.456.789-09'), passwordHash: FAKE_HASH },
      now,
    );
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.email).toBe('ana@example.com');
    expect(user.cpf).toBe('12345678909');
    expect(user.createdAt).toEqual(now);
    expect(user.updatedAt).toEqual(now);
  });

  it('collapses whitespace in the name', () => {
    expect(newUser().name).toBe('Ana Teste');
  });

  it.each(['', ' ', 'A', 'x'.repeat(121)])('cannot be born with invalid name %j', (name) => {
    expect(() => newUser(name)).toThrow(ValidationError);
  });

  it('cannot be born without a password hash', () => {
    expect(() =>
      User.register({ name: 'Ana Teste', email: Email.create('a@example.com'), cpf: Cpf.create('12345678909'), passwordHash: '' }),
    ).toThrow(ValidationError);
  });

  it('re-validates invariants when restored from persistence', () => {
    const snapshot = { ...newUser().toSnapshot(), cpf: '11111111111' };
    expect(() => User.restore(snapshot)).toThrow(ValidationError);
  });

  it('round-trips through its snapshot', () => {
    const user = newUser();
    expect(User.restore(user.toSnapshot()).toSnapshot()).toEqual(user.toSnapshot());
  });

  it('updates name and CPF but exposes no way to change the email', () => {
    const user = newUser();
    const later = new Date(user.updatedAt.getTime() + 1000);
    user.updateProfile({ name: 'Ana Atualizada', cpf: Cpf.create('111.444.777-35') }, later);

    expect(user.name).toBe('Ana Atualizada');
    expect(user.cpf).toBe('11144477735');
    expect(user.email).toBe('ana@example.com');
    expect(user.updatedAt).toEqual(later);
    expect(Object.getOwnPropertyDescriptor(User.prototype, 'email')?.set).toBeUndefined();
  });

  it('never serializes the password hash', () => {
    const user = newUser();
    expect(JSON.stringify(user)).not.toContain('argon2');
    expect(Object.keys(user)).not.toContain('passwordHash');
  });
});

describe('Workspace', () => {
  it('creates a personal workspace named after the owner, not the email', () => {
    const owner = newUser();
    const workspace = Workspace.createPersonal(owner);
    expect(workspace.kind).toBe('personal');
    expect(workspace.isPersonal).toBe(true);
    expect(workspace.name).toBe('Workspace de Ana Teste');
    expect(workspace.name).not.toContain('@');
    expect(workspace.id).not.toBe(owner.id);
  });

  it('cannot be restored with an empty name', () => {
    const snapshot = { ...Workspace.createPersonal(newUser()).toSnapshot(), name: ' ' };
    expect(() => Workspace.restore(snapshot)).toThrow(ValidationError);
  });
});

describe('Membership', () => {
  it('grants OWNER linking exactly the given user and workspace', () => {
    const owner = newUser();
    const workspace = Workspace.createPersonal(owner);
    const membership = Membership.grantOwner(owner, workspace);
    expect(membership).toMatchObject({ userId: owner.id, workspaceId: workspace.id, role: 'OWNER' });
    expect(membership.isOwner).toBe(true);
  });

  it('distinguishes non-owner roles', () => {
    const restored = Membership.restore({ userId: 'u', workspaceId: 'w', role: 'VIEWER', createdAt: new Date() });
    expect(restored.isOwner).toBe(false);
  });
});
