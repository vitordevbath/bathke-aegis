import { INCIDENT_TIMELINE_LIMITS, NotFoundError } from '@aegis/domain';
import type { Investigation } from '../../../domain/investigation.js';
import type { User } from '../../../domain/user.js';
import type { Repositories, StoredAlert, StoredEvent, StoredIncidentActivity } from '../../ports/repositories.js';
import type { WorkspaceAccess } from '../../workspace-access.js';
import type { IncidentView } from './incident-view.js';

/**
 * Everything needed to reconstruct an incident (ADR-054): its history, the alerts correlated into
 * it, the other events of the involved hosts around it and the investigations that group it. The
 * web builds the timeline and the relation graph from this one read.
 */
export interface IncidentTimeline extends IncidentView {
  readonly activities: readonly StoredIncidentActivity[];
  readonly alerts: readonly StoredAlert[];
  readonly alertsTruncated: boolean;
  readonly context: readonly StoredEvent[];
  readonly contextTruncated: boolean;
  readonly contextWindow: { readonly from: Date; readonly to: Date };
  readonly investigations: readonly Investigation[];
}

type TimelineRepositories = Pick<Repositories, 'incidents' | 'hosts' | 'detectionRules' | 'alerts' | 'events' | 'investigations' | 'incidentActivities'>;

/**
 * Read-only, for any member. The context window starts `contextPaddingMs` before the earliest fact of
 * the incident (its opening or its first alert) and ends when it was resolved, or now. Context events
 * exclude the events already shown through an alert; both lists are capped and flagged when cut.
 */
export class GetIncidentTimeline {
  constructor(
    private readonly access: WorkspaceAccess,
    private readonly repositories: TimelineRepositories,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(user: User, workspaceId: string, incidentId: string): Promise<IncidentTimeline> {
    await this.access.requireMember(user, workspaceId);
    const { incidents, hosts, detectionRules, alerts, events, investigations, incidentActivities } = this.repositories;
    const incident = await incidents.findInWorkspace(workspaceId, incidentId);
    if (!incident) throw new NotFoundError();

    const limits = INCIDENT_TIMELINE_LIMITS;
    const [foundHosts, foundRules, activities, foundAlerts, foundInvestigations] = await Promise.all([
      hosts.findManyInWorkspace(workspaceId, incident.hostIds),
      detectionRules.findManyInWorkspace(workspaceId, incident.detectionRuleIds),
      incidentActivities.listForIncident(workspaceId, incident.id),
      alerts.listForIncident(workspaceId, incident.id, limits.alerts + 1),
      investigations.listForIncident(workspaceId, incident.id),
    ]);
    const shownAlerts = foundAlerts.slice(0, limits.alerts);

    const openedAt = incident.toSnapshot().createdAt.getTime();
    const firstAlertAt = shownAlerts[0]?.alert.occurredAt.getTime() ?? openedAt;
    const from = new Date(Math.min(openedAt, firstAlertAt) - limits.contextPaddingMs);
    const to = incident.resolvedAt ?? this.clock();

    // Ask for enough rows to still fill the cap after dropping the alerts' own events.
    const alertEventIds = new Set(shownAlerts.map((stored) => stored.alert.eventId));
    const nearby = await events.listForHostsBetween(workspaceId, incident.hostIds, from, to, limits.contextEvents + alertEventIds.size + 1);
    const context = nearby.filter((stored) => !alertEventIds.has(stored.event.id));

    return {
      incident,
      hosts: foundHosts,
      detectionRules: foundRules,
      activities,
      alerts: shownAlerts,
      alertsTruncated: foundAlerts.length > limits.alerts,
      context: context.slice(0, limits.contextEvents),
      contextTruncated: context.length > limits.contextEvents,
      contextWindow: { from, to },
      investigations: foundInvestigations,
    };
  }
}
