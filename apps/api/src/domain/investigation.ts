import { randomUUID } from 'node:crypto';
import {
  Entity,
  INVESTIGATION_CLOSED_MESSAGE,
  INVESTIGATION_CONCLUSION_MESSAGE,
  INVESTIGATION_DESCRIPTION_MESSAGE,
  INVESTIGATION_INCIDENTS_REQUIRED_MESSAGE,
  INVESTIGATION_LIMITS,
  INVESTIGATION_STATUSES,
  INVESTIGATION_TITLE_MESSAGE,
  INVESTIGATION_TRANSITIONS,
  InvalidInvestigationTransitionError,
  InvalidStateError,
  InvestigationConclusionRequiredError,
  ValidationError,
  canTransitionInvestigation,
  closingConclusionProblem,
  type FieldIssue,
  type InvestigationStatus,
} from '@aegis/domain';

/** What a user may set on an investigation (PUT replaces all of it; status has its own path). */
export interface InvestigationDetails {
  readonly title: string;
  readonly description?: string | null | undefined;
  /** Draft or final human conclusion; required (≥ 10 characters) only to close. */
  readonly conclusion?: string | null | undefined;
  /** At least one incident of the same workspace, no duplicates. */
  readonly incidentIds: readonly string[];
}

export interface InvestigationSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly description: string | null;
  readonly conclusion: string | null;
  readonly status: InvestigationStatus;
  readonly incidentIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly closedAt: Date | null;
}

interface ValidDetails {
  readonly title: string;
  readonly description: string | null;
  readonly conclusion: string | null;
  readonly incidentIds: readonly string[];
}

/** Checks every user-editable invariant at once so callers get all field issues together. */
function validate(details: InvestigationDetails): ValidDetails {
  const issues: FieldIssue[] = [];
  const title = details.title.trim().replace(/\s+/g, ' ');
  if (title.length < INVESTIGATION_LIMITS.titleMin || title.length > INVESTIGATION_LIMITS.titleMax) {
    issues.push({ field: 'title', message: INVESTIGATION_TITLE_MESSAGE });
  }
  // Plain text: kept as typed (line breaks included), rendered escaped, never as HTML.
  const description = details.description?.trim() || null;
  if (description && description.length > INVESTIGATION_LIMITS.descriptionMax) issues.push({ field: 'description', message: INVESTIGATION_DESCRIPTION_MESSAGE });
  const conclusion = details.conclusion?.trim() || null;
  if (conclusion && conclusion.length > INVESTIGATION_LIMITS.conclusionMax) issues.push({ field: 'conclusion', message: INVESTIGATION_CONCLUSION_MESSAGE });

  if (details.incidentIds.length === 0) issues.push({ field: 'incidentIds', message: INVESTIGATION_INCIDENTS_REQUIRED_MESSAGE });
  if (details.incidentIds.length > INVESTIGATION_LIMITS.maxIncidents) {
    issues.push({ field: 'incidentIds', message: `Selecione no máximo ${INVESTIGATION_LIMITS.maxIncidents} incidentes.` });
  }
  if (new Set(details.incidentIds).size !== details.incidentIds.length) issues.push({ field: 'incidentIds', message: 'Há incidentes repetidos.' });

  if (issues.length > 0) throw new ValidationError('Investigação inválida.', issues);
  return { title, description, conclusion, incidentIds: [...details.incidentIds] };
}

/** Lifecycle fields read back from storage must be coherent, or the row is refused. */
function assertLifecycle(status: unknown, closedAt: Date | null, conclusion: string | null): asserts status is InvestigationStatus {
  const known = typeof status === 'string' && (INVESTIGATION_STATUSES as readonly string[]).includes(status);
  const closed = status === 'CLOSED';
  if (!known || closed !== (closedAt !== null) || (closed && closingConclusionProblem(conclusion) !== null)) {
    throw new ValidationError('Investigação com ciclo de vida inconsistente.', [{ field: 'status', message: 'Status inconsistente.' }]);
  }
}

/**
 * A human case that groups one or more incidents of a workspace and records
 * the analyst's conclusion. It never creates telemetry, runs rules or raises
 * alerts. The status only changes through `transitionTo`, which also owns
 * `closedAt` and refuses to close without a conclusion; a CLOSED
 * investigation is final and read-only.
 */
export class Investigation extends Entity<string> {
  readonly #workspaceId: string;
  #details: ValidDetails;
  #status: InvestigationStatus;
  readonly #createdAt: Date;
  #updatedAt: Date;
  #closedAt: Date | null;

  private constructor(snapshot: Omit<InvestigationSnapshot, keyof ValidDetails>, details: ValidDetails) {
    super(snapshot.id);
    this.#workspaceId = snapshot.workspaceId;
    this.#details = details;
    this.#status = snapshot.status;
    this.#createdAt = snapshot.createdAt;
    this.#updatedAt = snapshot.updatedAt;
    this.#closedAt = snapshot.closedAt;
  }

  /** Opens a case: always OPEN, without conclusion, not closed. */
  static open(workspaceId: string, details: Omit<InvestigationDetails, 'conclusion'>, now: Date = new Date()): Investigation {
    const lifecycle = { status: 'OPEN', closedAt: null } as const;
    return new Investigation({ id: randomUUID(), workspaceId, ...lifecycle, createdAt: now, updatedAt: now }, validate({ ...details, conclusion: null }));
  }

  static restore(snapshot: InvestigationSnapshot): Investigation {
    const { title, description, conclusion, incidentIds, ...record } = snapshot;
    const details = validate({ title, description, conclusion, incidentIds });
    assertLifecycle(record.status, record.closedAt, details.conclusion);
    return new Investigation(record, details);
  }

  get workspaceId(): string {
    return this.#workspaceId;
  }

  get title(): string {
    return this.#details.title;
  }

  get status(): InvestigationStatus {
    return this.#status;
  }

  get conclusion(): string | null {
    return this.#details.conclusion;
  }

  get closedAt(): Date | null {
    return this.#closedAt;
  }

  get incidentIds(): readonly string[] {
    return this.#details.incidentIds;
  }

  /** Statuses reachable from the current one (empty once CLOSED). */
  get availableTransitions(): readonly InvestigationStatus[] {
    return INVESTIGATION_TRANSITIONS[this.#status];
  }

  /** Replaces title, description, conclusion and incidents. Refused once the investigation is CLOSED. */
  revise(details: InvestigationDetails, now: Date = new Date()): void {
    if (this.#status === 'CLOSED') throw new InvalidStateError(INVESTIGATION_CLOSED_MESSAGE);
    this.#details = validate(details);
    this.#updatedAt = now;
  }

  /**
   * The single place status and `closedAt` change. Closing requires a
   * conclusion and stamps `closedAt`, which never goes back to null (CLOSED
   * is final). Asking for the current status is a no-op.
   */
  transitionTo(target: InvestigationStatus, now: Date = new Date()): void {
    if (target === this.#status) return;
    if (!canTransitionInvestigation(this.#status, target)) throw new InvalidInvestigationTransitionError(this.#status, target);
    if (target === 'CLOSED') {
      const problem = closingConclusionProblem(this.#details.conclusion);
      if (problem) throw new InvestigationConclusionRequiredError(problem);
      this.#closedAt = now;
    }
    this.#status = target;
    this.#updatedAt = now;
  }

  toSnapshot(): InvestigationSnapshot {
    return {
      id: this.id,
      workspaceId: this.#workspaceId,
      ...this.#details,
      status: this.#status,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      closedAt: this.#closedAt,
    };
  }
}
