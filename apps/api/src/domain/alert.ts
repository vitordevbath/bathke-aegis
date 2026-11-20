import { randomUUID } from 'node:crypto';
import { Entity, type Severity } from '@aegis/domain';

export interface AlertSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly ruleId: string;
  readonly eventId: string;
  readonly hostId: string;
  readonly incidentId: string | null;
  readonly severity: Severity;
  readonly occurredAt: Date;
  readonly createdAt: Date;
}

/**
 * The immutable fact that an enabled detection rule matched one ingested event (ADR-053). It carries
 * the rule's severity at the time of the match and the incident it was correlated into. There is no
 * alert lifecycle: triage, investigation and resolution happen on the incident.
 */
export class Alert extends Entity<string> {
  private constructor(private readonly snapshot: AlertSnapshot) {
    super(snapshot.id);
  }

  static raise(input: Omit<AlertSnapshot, 'id' | 'createdAt'>, now: Date = new Date()): Alert {
    return new Alert({ ...input, id: randomUUID(), createdAt: now });
  }

  static restore(snapshot: AlertSnapshot): Alert {
    return new Alert(snapshot);
  }

  get workspaceId(): string {
    return this.snapshot.workspaceId;
  }

  get ruleId(): string {
    return this.snapshot.ruleId;
  }

  get eventId(): string {
    return this.snapshot.eventId;
  }

  get hostId(): string {
    return this.snapshot.hostId;
  }

  get incidentId(): string | null {
    return this.snapshot.incidentId;
  }

  get severity(): Severity {
    return this.snapshot.severity;
  }

  get occurredAt(): Date {
    return this.snapshot.occurredAt;
  }

  get createdAt(): Date {
    return this.snapshot.createdAt;
  }

  toSnapshot(): AlertSnapshot {
    return { ...this.snapshot };
  }
}
