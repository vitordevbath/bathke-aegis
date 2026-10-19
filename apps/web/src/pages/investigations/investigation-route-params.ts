import { INVESTIGATION_STATUSES, type InvestigationStatus } from '@aegis/domain';

export const INVESTIGATIONS_PAGE_SIZE = 10;

export interface InvestigationListUrlState {
  page: number;
  q: string;
  status: InvestigationStatus | undefined;
}

/** Reads `?page=&q=&status=` defensively; unknown values are ignored. */
export function readInvestigationListParams(search: URLSearchParams): InvestigationListUrlState {
  const page = Number(search.get('page'));
  const status = search.get('status');
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    q: (search.get('q') ?? '').trim().slice(0, 160),
    status: status !== null && (INVESTIGATION_STATUSES as readonly string[]).includes(status) ? (status as InvestigationStatus) : undefined,
  };
}

export function writeInvestigationListParams(state: InvestigationListUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.status) params.set('status', state.status);
  if (state.page > 1) params.set('page', String(state.page));
  return params;
}
