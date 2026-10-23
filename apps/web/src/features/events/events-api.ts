import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { EventCategory, EventResponse, EventSummary, EventType, PaginatedResponse } from '@aegis/contracts';
import { apiRequest } from '../../lib/api-client';

export interface EventListParams {
  readonly page: number;
  readonly pageSize: number;
  readonly hostId?: string | undefined;
  readonly category?: EventCategory | undefined;
  readonly eventType?: EventType | undefined;
  /** RFC 3339 instants (inclusive). */
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export const eventKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'events'] as const,
  list: (workspaceId: string, params: EventListParams) => [...eventKeys.all(workspaceId), 'list', params] as const,
  detail: (workspaceId: string, eventId: string) => [...eventKeys.all(workspaceId), 'detail', eventId] as const,
};

const eventsPath = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/events`;

/** Read-only: the web never creates or edits events (they arrive through ingestion). */
export function useEventList(workspaceId: string | undefined, params: EventListParams) {
  return useQuery({
    queryKey: eventKeys.list(workspaceId ?? '', params),
    queryFn: () => {
      const search = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
      if (params.hostId) search.set('hostId', params.hostId);
      if (params.category) search.set('category', params.category);
      if (params.eventType) search.set('eventType', params.eventType);
      if (params.from) search.set('from', params.from);
      if (params.to) search.set('to', params.to);
      return apiRequest<PaginatedResponse<EventSummary>>(`${eventsPath(workspaceId ?? '')}?${search}`);
    },
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
}

export function useEvent(workspaceId: string | undefined, eventId: string | undefined) {
  return useQuery({
    queryKey: eventKeys.detail(workspaceId ?? '', eventId ?? ''),
    queryFn: () => apiRequest<EventResponse>(`${eventsPath(workspaceId ?? '')}/${encodeURIComponent(eventId ?? '')}`),
    enabled: Boolean(workspaceId && eventId),
    retry: false,
  });
}
