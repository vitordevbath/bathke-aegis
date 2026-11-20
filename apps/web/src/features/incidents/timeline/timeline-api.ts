import { useQuery } from '@tanstack/react-query';
import type { IncidentTimelineResponse } from '@aegis/contracts';
import { apiRequest } from '../../../lib/api-client';

/** Separate from `incidentKeys` so incident and investigation writes can both refresh it without importing each other. */
export const incidentTimelineKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'incident-timelines'] as const,
  detail: (workspaceId: string, incidentId: string) => [...incidentTimelineKeys.all(workspaceId), incidentId] as const,
};

/** History, alerts, nearby events and investigations of one incident (ADR-054). Refreshes while the page is open. */
export function useIncidentTimeline(workspaceId: string | undefined, incidentId: string | undefined) {
  return useQuery({
    queryKey: incidentTimelineKeys.detail(workspaceId ?? '', incidentId ?? ''),
    queryFn: () =>
      apiRequest<IncidentTimelineResponse>(`/workspaces/${encodeURIComponent(workspaceId ?? '')}/incidents/${encodeURIComponent(incidentId ?? '')}/timeline`),
    enabled: Boolean(workspaceId && incidentId),
    retry: false,
    refetchInterval: 30_000,
  });
}
