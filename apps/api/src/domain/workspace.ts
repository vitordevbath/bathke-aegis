import { randomUUID } from 'node:crypto';
import { Entity, ValidationError } from '@aegis/domain';
import type { User } from './user.js';

/** `personal` (one per user) and the single `demo` workspace are created; the others are reserved (ADR-009/012/052). */
export type WorkspaceKind = 'personal' | 'demo' | 'organization' | 'lab';

export interface WorkspaceSnapshot {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const NAME_MAX = 150;
export const DEMO_WORKSPACE_NAME = 'AEGIS DEMO';

/** Organizational boundary that will own hosts, rules, incidents and investigations. */
export class Workspace extends Entity<string> {
  private constructor(
    id: string,
    readonly name: string,
    readonly kind: WorkspaceKind,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {
    super(id);
    if (name.trim().length === 0 || name.length > NAME_MAX) {
      throw ValidationError.forField('name', `O nome do workspace deve ter entre 1 e ${NAME_MAX} caracteres.`);
    }
  }

  /** The workspace every user receives at registration. Named after the user, never the email. */
  static createPersonal(owner: User, now: Date = new Date()): Workspace {
    return new Workspace(randomUUID(), `Workspace de ${owner.name}`, 'personal', now, now);
  }

  /** The shared, read-only AEGIS DEMO workspace (ADR-052). There is at most one. */
  static createDemo(now: Date = new Date()): Workspace {
    return new Workspace(randomUUID(), DEMO_WORKSPACE_NAME, 'demo', now, now);
  }

  static restore(snapshot: WorkspaceSnapshot): Workspace {
    return new Workspace(snapshot.id, snapshot.name, snapshot.kind, snapshot.createdAt, snapshot.updatedAt);
  }

  get isPersonal(): boolean {
    return this.kind === 'personal';
  }

  toSnapshot(): WorkspaceSnapshot {
    return { id: this.id, name: this.name, kind: this.kind, createdAt: this.createdAt, updatedAt: this.updatedAt };
  }
}
