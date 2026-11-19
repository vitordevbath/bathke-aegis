import type { IncidentStatus } from './incident-rules.js';
import type { Severity } from './severity.js';

/**
 * Incident activity log (ADR-054): what happened to an incident, recorded in the same transaction
 * as the change. Entries are immutable facts; the timeline reads them next to the incident's alerts.
 */
export const INCIDENT_ACTIVITY_KINDS = [
  'OPENED',
  'STATUS_CHANGED',
  'SEVERITY_CHANGED',
  'DETAILS_UPDATED',
  'INVESTIGATION_LINKED',
  'INVESTIGATION_UNLINKED',
  'INVESTIGATION_CLOSED',
] as const;
export type IncidentActivityKind = (typeof INCIDENT_ACTIVITY_KINDS)[number];

/**
 * Who caused an entry. HISTORY_BACKFILL marks the entries the migration derived from rows that
 * existed before the log (the opening and the investigation links): the facts are real, the author
 * was never recorded.
 */
export const INCIDENT_ACTIVITY_ACTORS = ['USER', 'DETECTION_ENGINE', 'HISTORY_BACKFILL'] as const;
export type IncidentActivityActor = (typeof INCIDENT_ACTIVITY_ACTORS)[number];

/** Editable fields reported by DETAILS_UPDATED (severity and status have entries of their own). */
export const INCIDENT_DETAIL_FIELDS = ['title', 'description', 'hostIds', 'detectionRuleIds'] as const;
export type IncidentDetailField = (typeof INCIDENT_DETAIL_FIELDS)[number];

export const INCIDENT_DETAIL_FIELD_LABELS: Readonly<Record<IncidentDetailField, string>> = {
  title: 'título',
  description: 'descrição',
  hostIds: 'hosts envolvidos',
  detectionRuleIds: 'regras relacionadas',
};

/** The parts of an incident whose changes are logged. */
export interface IncidentActivityState {
  readonly title: string;
  readonly description: string | null;
  readonly severity: Severity;
  readonly status: IncidentStatus;
  readonly hostIds: readonly string[];
  readonly detectionRuleIds: readonly string[];
}

export type IncidentChange =
  | { readonly kind: 'STATUS_CHANGED'; readonly from: IncidentStatus; readonly to: IncidentStatus }
  | { readonly kind: 'SEVERITY_CHANGED'; readonly from: Severity; readonly to: Severity }
  | { readonly kind: 'DETAILS_UPDATED'; readonly fields: readonly IncidentDetailField[] };

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value) => b.includes(value));

/**
 * What an edit changed, in a fixed order (status, severity, other fields). An edit that changes
 * nothing yields nothing, so saving an untouched form leaves no noise in the history. Relations are
 * compared as sets: reordering hosts is not a change.
 */
export function diffIncident(before: IncidentActivityState, after: IncidentActivityState): IncidentChange[] {
  const changes: IncidentChange[] = [];
  if (before.status !== after.status) changes.push({ kind: 'STATUS_CHANGED', from: before.status, to: after.status });
  if (before.severity !== after.severity) changes.push({ kind: 'SEVERITY_CHANGED', from: before.severity, to: after.severity });
  const fields = INCIDENT_DETAIL_FIELDS.filter((field) => {
    if (field === 'hostIds' || field === 'detectionRuleIds') return !sameSet(before[field], after[field]);
    return before[field] !== after[field];
  });
  if (fields.length > 0) changes.push({ kind: 'DETAILS_UPDATED', fields });
  return changes;
}

/** Incidents added to and removed from an investigation by an edit, each in its original order. */
export function diffInvestigationLinks(before: readonly string[], after: readonly string[]): { linked: string[]; unlinked: string[] } {
  return {
    linked: after.filter((id) => !before.includes(id)),
    unlinked: before.filter((id) => !after.includes(id)),
  };
}

/**
 * Bounds of one incident timeline. Context events are the other events of the involved hosts around
 * the incident: from `contextPaddingMs` before its first fact until it was resolved (or now).
 */
export const INCIDENT_TIMELINE_LIMITS = {
  alerts: 200,
  contextEvents: 100,
  contextPaddingMs: 15 * 60_000,
} as const;
