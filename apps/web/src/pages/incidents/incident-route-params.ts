import { INCIDENT_ORIGINS, INCIDENT_STATUSES, SEVERITIES, type IncidentOrigin, type IncidentStatus, type Severity } from '@aegis/domain';

export const INCIDENTS_PAGE_SIZE = 10;

export interface IncidentListUrlState {
  page: number;
  q: string;
  severity: Severity | undefined;
  status: IncidentStatus | undefined;
  origin: IncidentOrigin | undefined;
}

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  value !== null && (list as readonly string[]).includes(value) ? (value as T) : undefined;

/** Reads `?page=&q=&severity=&status=&origin=` defensively; unknown values are ignored. */
export function readIncidentListParams(search: URLSearchParams): IncidentListUrlState {
  const page = Number(search.get('page'));
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    q: (search.get('q') ?? '').trim().slice(0, 160),
    severity: oneOf(SEVERITIES, search.get('severity')),
    status: oneOf(INCIDENT_STATUSES, search.get('status')),
    origin: oneOf(INCIDENT_ORIGINS, search.get('origin')),
  };
}

export function writeIncidentListParams(state: IncidentListUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.severity) params.set('severity', state.severity);
  if (state.status) params.set('status', state.status);
  if (state.origin) params.set('origin', state.origin);
  if (state.page > 1) params.set('page', String(state.page));
  return params;
}
