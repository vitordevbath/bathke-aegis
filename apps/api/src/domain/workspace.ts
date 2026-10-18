import { randomUUID } from 'node:crypto';
import { Entity, ValidationError } from '@aegis/domain';
import type { User } from './user.js';

/** Only `personal` is created in this phase; the others are reserved (ADR-009/012). */
export type WorkspaceKind = 'personal' | 'demo' | 'organization' | 'lab';

export interface WorkspaceSnapshot {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkspaceKind;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const NAME_MAX = 150;

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
