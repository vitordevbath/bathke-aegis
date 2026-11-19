import type { IncidentActivityActor, IncidentActivityKind, IncidentDetailField, InvestigationStatus } from '@aegis/domain';
import type { AlertResponse } from './alerts.js';
import type { EventSummary } from './events.js';
import type { IncidentResponse } from './incidents.js';

/** One immutable entry of an incident's history (ADR-054). */
export interface IncidentActivityResponse {
  readonly id: string;
  readonly kind: IncidentActivityKind;
  /** `name` is the user's current name; null for the engine, backfilled entries or a removed user. */
  readonly actor: { readonly kind: IncidentActivityActor; readonly name: string | null };
  readonly createdAt: string;
  /** STATUS_CHANGED and SEVERITY_CHANGED: previous and new value. */
  readonly from: string | null;
  readonly to: string | null;
  /** DETAILS_UPDATED: the fields that changed. */
  readonly fields: readonly IncidentDetailField[] | null;
  /** Investigation entries: `id` is null once the investigation was deleted; the title is the one it had. */
  readonly investigation: { readonly id: string | null; readonly title: string } | null;
}

/** An investigation that currently groups the incident. */
export interface IncidentTimelineInvestigation {
  readonly investigationId: string;
  readonly title: string;
  readonly status: InvestigationStatus;
}

/**
 * `GET /workspaces/:workspaceId/incidents/:incidentId/timeline`: everything needed to reconstruct the
 * incident. The web merges the lists into one timeline and draws the relation graph from them.
 */
export interface IncidentTimelineResponse {
  readonly incident: IncidentResponse;
  /** Oldest first. */
  readonly activities: readonly IncidentActivityResponse[];
  /** Correlated alerts, oldest event first; `alertsTruncated` when the cap cut the list. */
  readonly alerts: readonly AlertResponse[];
  readonly alertsTruncated: boolean;
  /** Other events of the involved hosts inside `contextWindow`, oldest first, without the alerts' own events. */
  readonly context: readonly EventSummary[];
  readonly contextTruncated: boolean;
  readonly contextWindow: { readonly from: string; readonly to: string };
  readonly investigations: readonly IncidentTimelineInvestigation[];
}
