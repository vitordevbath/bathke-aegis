import { EVENT_CATEGORIES, EVENT_DEFINITIONS, EVENT_TYPES, type EventCategory, type EventType } from '@aegis/domain';

export const EVENTS_PAGE_SIZE = 20;

export interface EventListUrlState {
  page: number;
  hostId: string | undefined;
  category: EventCategory | undefined;
  eventType: EventType | undefined;
  /** `datetime-local` values (the viewer's local time), as typed in the filters. */
  from: string;
  to: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const oneOf = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  value !== null && (list as readonly string[]).includes(value) ? (value as T) : undefined;

/** Reads `?page=&hostId=&category=&eventType=&from=&to=` defensively; unknown values are ignored. */
export function readEventListParams(search: URLSearchParams): EventListUrlState {
  const page = Number(search.get('page'));
  const category = oneOf(EVENT_CATEGORIES, search.get('category'));
  const eventType = oneOf(EVENT_TYPES, search.get('eventType'));
  const hostId = search.get('hostId');
  const local = (key: string) => {
    const value = search.get(key) ?? '';
    return LOCAL.test(value) ? value : '';
  };
  return {
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    hostId: hostId && UUID.test(hostId) ? hostId : undefined,
    category,
    // A type of another category would only ever return an empty list: drop it.
    eventType: eventType && (!category || EVENT_DEFINITIONS[eventType].category === category) ? eventType : undefined,
    from: local('from'),
    to: local('to'),
  };
}

export function writeEventListParams(state: EventListUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.hostId) params.set('hostId', state.hostId);
  if (state.category) params.set('category', state.category);
  if (state.eventType) params.set('eventType', state.eventType);
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  if (state.page > 1) params.set('page', String(state.page));
  return params;
}

/** `datetime-local` (viewer's local time) → RFC 3339 instant for the API; the end of the minute is included. */
export function toInstant(local: string, edge: 'start' | 'end'): string | undefined {
  if (!local) return undefined;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return undefined;
  if (edge === 'end') date.setSeconds(59, 999);
  return date.toISOString();
}
