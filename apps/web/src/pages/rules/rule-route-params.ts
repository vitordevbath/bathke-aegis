import { DETECTION_EVENT_CATEGORIES, DETECTION_SEVERITIES, type DetectionEventCategory, type DetectionSeverity } from '@aegis/domain';

export const RULES_PAGE_SIZE = 10;

export interface RuleListUrlState {
  page: number;
  q: string;
  severity: DetectionSeverity | undefined;
  eventCategory: DetectionEventCategory | undefined;
  enabled: boolean | undefined;
}

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  value !== null && (list as readonly string[]).includes(value) ? (value as T) : undefined;

/** Reads `?page=&q=&severity=&eventCategory=&enabled=` defensively; unknown values are ignored. */
export function readRuleListParams(search: URLSearchParams): RuleListUrlState {
  const page = Number(search.get('page'));
  const enabled = search.get('enabled');
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    q: (search.get('q') ?? '').trim().slice(0, 120),
    severity: oneOf(DETECTION_SEVERITIES, search.get('severity')),
    eventCategory: oneOf(DETECTION_EVENT_CATEGORIES, search.get('eventCategory')),
    enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
  };
}

export function writeRuleListParams(state: RuleListUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.severity) params.set('severity', state.severity);
  if (state.eventCategory) params.set('eventCategory', state.eventCategory);
  if (state.enabled !== undefined) params.set('enabled', String(state.enabled));
  if (state.page > 1) params.set('page', String(state.page));
  return params;
}
