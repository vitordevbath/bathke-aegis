import type { AlertResponse, EventSummary, IncidentActivityResponse, IncidentTimelineResponse } from '@aegis/contracts';
import { INCIDENT_DETAIL_FIELD_LABELS, INCIDENT_STATUS_LABELS, type IncidentStatus, type Severity } from '@aegis/domain';
import { SEVERITY_LABELS } from '../../../lib/severity';

/** One fact on the timeline. `at` is when it happened: on the machine for events and alerts, on the server for history. */
export type TimelineEntry =
  | { readonly kind: 'activity'; readonly id: string; readonly at: string; readonly activity: IncidentActivityResponse }
  | { readonly kind: 'alert'; readonly id: string; readonly at: string; readonly alert: AlertResponse }
  | { readonly kind: 'context'; readonly id: string; readonly at: string; readonly event: EventSummary }
  | { readonly kind: 'boundary'; readonly id: string; readonly at: string; readonly boundary: 'window-start' | 'window-end' };

export type TimelineRow =
  | { readonly type: 'day'; readonly id: string; readonly label: string }
  | { readonly type: 'entry'; readonly entry: TimelineEntry }
  /** Consecutive context events folded into one expandable line, so alerts and history stay readable. */
  | { readonly type: 'context-run'; readonly id: string; readonly events: readonly EventSummary[] };

export type TimelineFilter = 'all' | 'alerts' | 'history' | 'context';

export const TIMELINE_FILTERS: readonly { readonly value: TimelineFilter; readonly label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'alerts', label: 'Alertas' },
  { value: 'history', label: 'Histórico' },
  { value: 'context', label: 'Eventos ao redor' },
];

/** Runs shorter than this stay expanded: folding two events saves nothing. */
export const CONTEXT_RUN_MIN = 4;

/** At equal instants: the window opens first, then what the machine saw, then what people and the engine did. */
const ORDER: Record<TimelineEntry['kind'], number> = { boundary: 0, context: 1, alert: 2, activity: 3 };

function entriesOf(timeline: IncidentTimelineResponse, filter: TimelineFilter): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  if (filter === 'all' || filter === 'history') {
    for (const activity of timeline.activities) entries.push({ kind: 'activity', id: `activity:${activity.id}`, at: activity.createdAt, activity });
  }
  if (filter === 'all' || filter === 'alerts') {
    for (const alert of timeline.alerts) entries.push({ kind: 'alert', id: `alert:${alert.id}`, at: alert.occurredAt, alert });
  }
  if (filter === 'all' || filter === 'context') {
    for (const event of timeline.context) entries.push({ kind: 'context', id: `event:${event.id}`, at: event.occurredAt, event });
  }
  if (filter === 'all' || filter === 'context') {
    entries.push({ kind: 'boundary', id: 'boundary:start', at: timeline.contextWindow.from, boundary: 'window-start' });
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at) || ORDER[a.kind] - ORDER[b.kind]);
}

const dayFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (iso: string) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

/**
 * Merges the history, the alerts and the nearby events into dated rows, oldest first. The window end
 * closes the list when the incident is resolved (otherwise the list simply ends at the latest fact).
 */
export function buildTimelineRows(timeline: IncidentTimelineResponse, filter: TimelineFilter): TimelineRow[] {
  const entries = entriesOf(timeline, filter);
  if ((filter === 'all' || filter === 'context') && timeline.incident.resolvedAt) {
    entries.push({ kind: 'boundary', id: 'boundary:end', at: timeline.contextWindow.to, boundary: 'window-end' });
  }

  const rows: TimelineRow[] = [];
  let currentDay = '';
  let run: EventSummary[] = [];
  const flush = () => {
    if (run.length >= CONTEXT_RUN_MIN) rows.push({ type: 'context-run', id: `run:${run[0]?.id}`, events: run });
    else for (const event of run) rows.push({ type: 'entry', entry: { kind: 'context', id: `event:${event.id}`, at: event.occurredAt, event } });
    run = [];
  };

  for (const entry of entries) {
    const key = dayKey(entry.at);
    if (key !== currentDay) {
      flush();
      currentDay = key;
      rows.push({ type: 'day', id: `day:${key}`, label: dayFormat.format(new Date(entry.at)) });
    }
    if (entry.kind === 'context' && filter === 'all') {
      run.push(entry.event);
      continue;
    }
    flush();
    rows.push({ type: 'entry', entry });
  }
  flush();
  return rows;
}

const quoted = (title: string) => `“${title}”`;

function joinFields(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
}

/** Who caused an entry, in words. */
export function activityActor(activity: IncidentActivityResponse): string {
  if (activity.actor.kind === 'DETECTION_ENGINE') return 'Motor de detecção';
  if (activity.actor.kind === 'HISTORY_BACKFILL') return 'Registro anterior ao histórico';
  return activity.actor.name ?? 'Usuário removido';
}

/** What an entry says happened. Values come from the server; only the wording lives here. */
export function describeActivity(activity: IncidentActivityResponse): string {
  const investigation = activity.investigation ? quoted(activity.investigation.title) : 'excluída';
  switch (activity.kind) {
    case 'OPENED':
      return activity.actor.kind === 'DETECTION_ENGINE' ? 'Incidente aberto pelo motor' : 'Incidente registrado';
    case 'STATUS_CHANGED':
      return `Status: ${INCIDENT_STATUS_LABELS[activity.from as IncidentStatus] ?? activity.from} → ${INCIDENT_STATUS_LABELS[activity.to as IncidentStatus] ?? activity.to}`;
    case 'SEVERITY_CHANGED':
      return `Severidade: ${SEVERITY_LABELS[activity.from as Severity] ?? activity.from} → ${SEVERITY_LABELS[activity.to as Severity] ?? activity.to}`;
    case 'DETAILS_UPDATED':
      return `Editou ${joinFields((activity.fields ?? []).map((field) => INCIDENT_DETAIL_FIELD_LABELS[field]))}`;
    case 'INVESTIGATION_LINKED':
      return `Entrou na investigação ${investigation}`;
    case 'INVESTIGATION_UNLINKED':
      return `Saiu da investigação ${investigation}`;
    case 'INVESTIGATION_CLOSED':
      return `Investigação ${investigation} concluída`;
  }
}
