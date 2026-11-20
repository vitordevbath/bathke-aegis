import { randomUUID } from 'node:crypto';
import { Entity, type IncidentActivityActor, type IncidentActivityKind, type IncidentChange, type IncidentDetailField } from '@aegis/domain';

/** Who causes a new entry. HISTORY_BACKFILL is written only by the migration (ADR-054). */
export type ActivityAuthor = { readonly kind: 'USER'; readonly userId: string } | { readonly kind: 'DETECTION_ENGINE' };

export interface IncidentActivitySnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly incidentId: string;
  readonly kind: IncidentActivityKind;
  readonly actor: IncidentActivityActor;
  /** Null for the engine, for backfilled entries and once the user no longer exists. */
  readonly actorUserId: string | null;
  /** Previous and new status or severity (STATUS_CHANGED, SEVERITY_CHANGED). */
  readonly fromValue: string | null;
  readonly toValue: string | null;
  /** Investigation entries keep the title they had, so the history reads the same after a rename or deletion. */
  readonly investigationId: string | null;
  readonly investigationTitle: string | null;
  /** DETAILS_UPDATED only. */
  readonly fields: readonly IncidentDetailField[] | null;
  readonly createdAt: Date;
}

interface IncidentRef {
  readonly id: string;
  readonly workspaceId: string;
}

interface InvestigationRef {
  readonly id: string;
  readonly title: string;
}

type InvestigationActivityKind = Extract<IncidentActivityKind, 'INVESTIGATION_LINKED' | 'INVESTIGATION_UNLINKED' | 'INVESTIGATION_CLOSED'>;

const EMPTY = { fromValue: null, toValue: null, investigationId: null, investigationTitle: null, fields: null } as const;

/**
 * One immutable entry of an incident's history (ADR-054), written in the same transaction as the
 * change it describes. There is no update or delete path: entries leave only with their incident.
 */
export class IncidentActivity extends Entity<string> {
  private constructor(private readonly snapshot: IncidentActivitySnapshot) {
    super(snapshot.id);
  }

  private static create(
    incident: IncidentRef,
    author: ActivityAuthor,
    kind: IncidentActivityKind,
    body: Pick<IncidentActivitySnapshot, keyof typeof EMPTY>,
    now: Date,
  ): IncidentActivity {
    return new IncidentActivity({
      id: randomUUID(),
      workspaceId: incident.workspaceId,
      incidentId: incident.id,
      kind,
      actor: author.kind,
      actorUserId: author.kind === 'USER' ? author.userId : null,
      ...body,
      createdAt: now,
    });
  }

  static opened(incident: IncidentRef, author: ActivityAuthor, now: Date = new Date()): IncidentActivity {
    return IncidentActivity.create(incident, author, 'OPENED', EMPTY, now);
  }

  static changed(incident: IncidentRef, change: IncidentChange, author: ActivityAuthor, now: Date = new Date()): IncidentActivity {
    if (change.kind === 'DETAILS_UPDATED') return IncidentActivity.create(incident, author, change.kind, { ...EMPTY, fields: [...change.fields] }, now);
    return IncidentActivity.create(incident, author, change.kind, { ...EMPTY, fromValue: change.from, toValue: change.to }, now);
  }

  static investigation(
    incident: IncidentRef,
    kind: InvestigationActivityKind,
    investigation: InvestigationRef,
    author: ActivityAuthor,
    now: Date = new Date(),
  ): IncidentActivity {
    return IncidentActivity.create(incident, author, kind, { ...EMPTY, investigationId: investigation.id, investigationTitle: investigation.title }, now);
  }

  static restore(snapshot: IncidentActivitySnapshot): IncidentActivity {
    return new IncidentActivity(snapshot);
  }

  get incidentId(): string {
    return this.snapshot.incidentId;
  }

  get kind(): IncidentActivityKind {
    return this.snapshot.kind;
  }

  get createdAt(): Date {
    return this.snapshot.createdAt;
  }

  toSnapshot(): IncidentActivitySnapshot {
    return { ...this.snapshot, fields: this.snapshot.fields ? [...this.snapshot.fields] : null };
  }
}
