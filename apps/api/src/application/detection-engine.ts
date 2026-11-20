import { CORRELATION_WINDOW_MS, INCIDENT_LIMITS, matchesDetection, type EventCategory } from '@aegis/domain';
import { Alert } from '../domain/alert.js';
import type { DetectionRule } from '../domain/detection-rule.js';
import type { Host } from '../domain/host.js';
import { Incident } from '../domain/incident.js';
import type { TelemetryEvent } from '../domain/telemetry-event.js';
import type { Repositories } from './ports/repositories.js';

/** Fits the incident title limit without cutting a word in half when possible. */
function incidentTitle(rule: DetectionRule, host: Host): string {
  const title = `${rule.name} em ${host.displayName}`;
  if (title.length <= INCIDENT_LIMITS.titleMax) return title;
  return `${title.slice(0, INCIDENT_LIMITS.titleMax - 1).replace(/\s+\S*$/, '')}…`;
}

/**
 * Detection engine (ADR-053). Runs inside the ingestion transaction, after the host lock and the
 * insert of the batch's new events, so an event, its alerts and their incident are committed together
 * or not at all. Only newly stored events are evaluated: a replayed batch raises nothing new.
 *
 * For each new event, every enabled rule of the event's category that applies to the host is
 * evaluated (`matchesDetection`). A match raises one alert and correlates it:
 * - to the open (OPEN or INVESTIGATING) incident of the latest alert of the same rule on the same host
 *   raised within `CORRELATION_WINDOW_MS`, when there is one;
 * - otherwise to a new incident with origin DETECTION_ENGINE, the rule's severity, that host and rule.
 * Batches of one host serialize on the host lock, so two batches cannot open twin incidents.
 */
export class DetectionEngine {
  async evaluate(repositories: Repositories, host: Host, events: readonly TelemetryEvent[], now: Date): Promise<number> {
    if (events.length === 0) return 0;
    const rulesByCategory = new Map<EventCategory, DetectionRule[]>();
    for (const category of new Set(events.map((event) => event.event.category))) {
      const rules = await repositories.detectionRules.listEnabledFor(host.workspaceId, category);
      rulesByCategory.set(
        category,
        rules.filter((rule) => rule.appliesTo(host.id)),
      );
    }

    const since = new Date(now.getTime() - CORRELATION_WINDOW_MS);
    const incidentOfRule = new Map<string, string>();
    const raised: Alert[] = [];
    const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    for (const event of ordered) {
      for (const rule of rulesByCategory.get(event.event.category) ?? []) {
        if (!matchesDetection(rule.definition, event.event)) continue;
        let incidentId = incidentOfRule.get(rule.id) ?? (await repositories.alerts.findCorrelatedIncident(host.workspaceId, rule.id, host.id, since));
        if (!incidentId) {
          const incident = Incident.openFromDetection(
            host.workspaceId,
            {
              title: incidentTitle(rule, host),
              description: `Aberto automaticamente pelo motor de detecção: a regra "${rule.name}" casou com um evento de ${host.displayName}. Novos alertas da mesma regra neste host, em até ${CORRELATION_WINDOW_MS / 60_000} minutos, entram neste incidente enquanto ele estiver aberto ou em investigação.`,
              severity: rule.severity,
              hostIds: [host.id],
              detectionRuleIds: [rule.id],
            },
            now,
          );
          await repositories.incidents.insert(incident);
          incidentId = incident.id;
        }
        incidentOfRule.set(rule.id, incidentId);
        raised.push(
          Alert.raise(
            { workspaceId: host.workspaceId, ruleId: rule.id, eventId: event.id, hostId: host.id, incidentId, severity: rule.severity, occurredAt: event.occurredAt },
            now,
          ),
        );
      }
    }
    await repositories.alerts.insertMany(raised);
    return raised.length;
  }
}
