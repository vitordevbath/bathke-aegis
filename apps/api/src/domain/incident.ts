import { randomUUID } from 'node:crypto';
import {
  Entity,
  INCIDENT_CLOSED_MESSAGE,
  INCIDENT_DESCRIPTION_MESSAGE,
  INCIDENT_HOSTS_REQUIRED_MESSAGE,
  INCIDENT_LIMITS,
  INCIDENT_ORIGINS,
  INCIDENT_STATUSES,
  INCIDENT_TITLE_MESSAGE,
  INCIDENT_TRANSITIONS,
  InvalidIncidentTransitionError,
  InvalidStateError,
  SEVERITIES,
  ValidationError,
  canTransitionIncident,
  incidentStatusHasResolution,
  type FieldIssue,
  type IncidentOrigin,
  type IncidentStatus,
  type Severity,
} from '@aegis/domain';

/** What a user may set on an incident (PUT replaces all of it; status has its own path). */
export interface IncidentDetails {
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly severity: Severity;
  /** At least one host of the same workspace, no duplicates. */
  readonly hostIds: readonly string[];
  /** Optional related rules of the same workspace, no duplicates. */
  readonly detectionRuleIds: readonly string[];
}

export interface IncidentSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly description: string | null;
  readonly severity: Severity;
  readonly status: IncidentStatus;
  readonly origin: IncidentOrigin;
  readonly hostIds: readonly string[];
  readonly detectionRuleIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resolvedAt: Date | null;
}

interface ValidDetails {
  readonly title: string;
  readonly description: string | null;
  readonly severity: Severity;
  readonly hostIds: readonly string[];
  readonly detectionRuleIds: readonly string[];
}

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** Checks every user-editable invariant at once so callers get all field issues together. */
function validate(details: IncidentDetails): ValidDetails {
  const issues: FieldIssue[] = [];
  const title = details.title.trim().replace(/\s+/g, ' ');
  if (title.length < INCIDENT_LIMITS.titleMin || title.length > INCIDENT_LIMITS.titleMax) {
    issues.push({ field: 'title', message: INCIDENT_TITLE_MESSAGE });
  }
  // Plain text: kept as typed (line breaks included), rendered escaped, never as HTML.
  const description = details.description?.trim() || null;
  if (description && description.length > INCIDENT_LIMITS.descriptionMax) issues.push({ field: 'description', message: INCIDENT_DESCRIPTION_MESSAGE });
  if (!oneOf(SEVERITIES, details.severity)) issues.push({ field: 'severity', message: 'Severidade inválida.' });

  if (details.hostIds.length === 0) issues.push({ field: 'hostIds', message: INCIDENT_HOSTS_REQUIRED_MESSAGE });
  if (details.hostIds.length > INCIDENT_LIMITS.maxHosts) issues.push({ field: 'hostIds', message: `Selecione no máximo ${INCIDENT_LIMITS.maxHosts} hosts.` });
  if (new Set(details.hostIds).size !== details.hostIds.length) issues.push({ field: 'hostIds', message: 'Há hosts repetidos.' });
  if (details.detectionRuleIds.length > INCIDENT_LIMITS.maxDetectionRules) {
    issues.push({ field: 'detectionRuleIds', message: `Selecione no máximo ${INCIDENT_LIMITS.maxDetectionRules} regras.` });
  }
  if (new Set(details.detectionRuleIds).size !== details.detectionRuleIds.length) {
    issues.push({ field: 'detectionRuleIds', message: 'Há regras repetidas.' });
  }

  if (issues.length > 0) throw new ValidationError('Incidente inválido.', issues);
  return { title, description, severity: details.severity, hostIds: [...details.hostIds], detectionRuleIds: [...details.detectionRuleIds] };
}

/** Lifecycle fields read back from storage must be coherent, or the row is refused. */
function assertLifecycle(status: unknown, origin: unknown, resolvedAt: Date | null): asserts status is IncidentStatus {
  if (!oneOf(INCIDENT_STATUSES, status) || !oneOf(INCIDENT_ORIGINS, origin) || incidentStatusHasResolution(status) !== (resolvedAt !== null)) {
    throw new ValidationError('Incidente com ciclo de vida inconsistente.', [{ field: 'status', message: 'Status inconsistente.' }]);
  }
}

/**
 * A security case that deserves human follow-up, owned by a workspace. Today
 * incidents are registered manually: nothing creates them automatically (no
 * events, alerts or correlation engine exist yet). The status only changes
 * through `transitionTo`, which also owns `resolvedAt`; a CLOSED incident is
 * final and read-only.
 */
export class Incident extends Entity<string> {
  readonly #workspaceId: string;
  #details: ValidDetails;
  #status: IncidentStatus;
  readonly #origin: IncidentOrigin;
  readonly #createdAt: Date;
  #updatedAt: Date;
  #resolvedAt: Date | null;

  private constructor(snapshot: Omit<IncidentSnapshot, keyof ValidDetails>, details: ValidDetails) {
    super(snapshot.id);
    this.#workspaceId = snapshot.workspaceId;
    this.#details = details;
    this.#status = snapshot.status;
    this.#origin = snapshot.origin;
    this.#createdAt = snapshot.createdAt;
    this.#updatedAt = snapshot.updatedAt;
    this.#resolvedAt = snapshot.resolvedAt;
  }

  /** Registers a manual incident: always OPEN, origin MANUAL, unresolved. */
  static open(workspaceId: string, details: IncidentDetails, now: Date = new Date()): Incident {
    const lifecycle = { status: 'OPEN', origin: 'MANUAL', resolvedAt: null } as const;
    return new Incident({ id: randomUUID(), workspaceId, ...lifecycle, createdAt: now, updatedAt: now }, validate(details));
  }

  static restore(snapshot: IncidentSnapshot): Incident {
    const { title, description, severity, hostIds, detectionRuleIds, ...record } = snapshot;
    assertLifecycle(record.status, record.origin, record.resolvedAt);
    return new Incident(record, validate({ title, description, severity, hostIds, detectionRuleIds }));
  }

  get workspaceId(): string {
    return this.#workspaceId;
  }

  get title(): string {
    return this.#details.title;
  }

  get status(): IncidentStatus {
    return this.#status;
  }

  get resolvedAt(): Date | null {
    return this.#resolvedAt;
  }

  get hostIds(): readonly string[] {
    return this.#details.hostIds;
  }

  get detectionRuleIds(): readonly string[] {
    return this.#details.detectionRuleIds;
  }

  /** Statuses reachable from the current one (empty once CLOSED). */
  get availableTransitions(): readonly IncidentStatus[] {
    return INCIDENT_TRANSITIONS[this.#status];
  }

  /** Replaces title, description, severity and relations. Refused once the incident is CLOSED. */
  revise(details: IncidentDetails, now: Date = new Date()): void {
    if (this.#status === 'CLOSED') throw new InvalidStateError(INCIDENT_CLOSED_MESSAGE);
    this.#details = validate(details);
    this.#updatedAt = now;
  }

  /**
   * The single place status and `resolvedAt` change. Entering RESOLVED stamps
   * the resolution; reopening (RESOLVED → INVESTIGATING) clears it; CLOSED
   * keeps it (CLOSED is only reachable from RESOLVED). Asking for the current
   * status is a no-op.
   */
  transitionTo(target: IncidentStatus, now: Date = new Date()): void {
    if (target === this.#status) return;
    if (!canTransitionIncident(this.#status, target)) throw new InvalidIncidentTransitionError(this.#status, target);
    if (target === 'RESOLVED') this.#resolvedAt = now;
    else if (!incidentStatusHasResolution(target)) this.#resolvedAt = null;
    this.#status = target;
    this.#updatedAt = now;
  }

  toSnapshot(): IncidentSnapshot {
    return {
      id: this.id,
      workspaceId: this.#workspaceId,
      ...this.#details,
      status: this.#status,
      origin: this.#origin,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      resolvedAt: this.#resolvedAt,
    };
  }
}
