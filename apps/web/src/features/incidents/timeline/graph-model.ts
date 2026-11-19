import type { IncidentTimelineResponse } from '@aegis/contracts';
import type { Severity } from '@aegis/domain';
import { TYPE_LABELS } from '../../events/event-labels';

/**
 * The relation graph of one incident, read left to right as the chain of causes: a host produced an
 * event, a rule matched it and raised an alert, the alert was correlated into the incident, and an
 * investigation groups the incident. Built only from the timeline response (no extra request).
 */
export type GraphNodeKind = 'host' | 'event' | 'rule' | 'alert' | 'incident' | 'investigation' | 'more-alerts';

export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly caption: string;
  /** Null for the incident itself (the page already shows it). */
  readonly href: string | null;
  readonly severity?: Severity;
  readonly x: number;
  readonly y: number;
}

export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** A relation recorded by hand (manual incidents) rather than produced by the engine. */
  readonly declared: boolean;
  /** Column of the source node: edges draw in column order. */
  readonly column: number;
}

export interface GraphColumn {
  readonly kind: GraphNodeKind;
  readonly title: string;
  readonly x: number;
}

export interface IncidentGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly columns: readonly GraphColumn[];
  readonly width: number;
  readonly height: number;
}

/** More alerts than this fold into one "+N" node: the graph shows shape, the list shows every row. */
export const GRAPH_MAX_ALERTS = 8;

export const GRAPH_LAYOUT = { nodeWidth: 168, nodeHeight: 48, columnGap: 56, rowGap: 14, top: 40, side: 4 } as const;

const COLUMN_ORDER: readonly { readonly kind: GraphNodeKind; readonly title: string }[] = [
  { kind: 'host', title: 'Hosts' },
  { kind: 'event', title: 'Eventos' },
  { kind: 'rule', title: 'Regras' },
  { kind: 'alert', title: 'Alertas' },
  { kind: 'incident', title: 'Incidente' },
  { kind: 'investigation', title: 'Investigações' },
];

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

type Draft = Omit<GraphNode, 'x' | 'y'>;

export function buildIncidentGraph(timeline: IncidentTimelineResponse): IncidentGraph {
  const { incident } = timeline;
  const drafts = new Map<string, Draft>();
  const add = (node: Draft) => {
    if (!drafts.has(node.id)) drafts.set(node.id, node);
  };
  const edges: { from: string; to: string; declared: boolean }[] = [];
  const link = (from: string, to: string, declared = false) => {
    if (!edges.some((edge) => edge.from === from && edge.to === to)) edges.push({ from, to, declared });
  };

  const incidentId = `incident:${incident.id}`;
  add({ id: incidentId, kind: 'incident', label: incident.title, caption: 'Este incidente', href: null, severity: incident.severity });

  const shown = timeline.alerts.slice(0, GRAPH_MAX_ALERTS);
  const hidden = timeline.alerts.length - shown.length;

  // Hosts and rules in order of first appearance along the alerts, then the ones recorded on the incident.
  for (const alert of shown) {
    const hostId = `host:${alert.host.id}`;
    const eventId = `event:${alert.event.id}`;
    const ruleId = `rule:${alert.rule.id}`;
    const alertId = `alert:${alert.id}`;
    add({ id: hostId, kind: 'host', label: alert.host.displayName, caption: 'Host', href: `/hosts/${alert.host.id}` });
    add({ id: eventId, kind: 'event', label: TYPE_LABELS[alert.event.type], caption: timeFormat.format(new Date(alert.occurredAt)), href: `/eventos/${alert.event.id}` });
    add({ id: ruleId, kind: 'rule', label: alert.rule.name, caption: 'Regra', href: `/regras/${alert.rule.id}` });
    add({ id: alertId, kind: 'alert', label: alert.event.summary, caption: `Alerta · ${timeFormat.format(new Date(alert.occurredAt))}`, href: `/alertas/${alert.id}`, severity: alert.severity });
    link(hostId, eventId);
    link(eventId, alertId);
    link(ruleId, alertId);
    link(alertId, incidentId);
  }
  if (hidden > 0 || timeline.alertsTruncated) {
    const moreId = 'more-alerts';
    const caption = timeline.alertsTruncated ? 'E outros além do limite' : 'Ver todos na lista';
    add({ id: moreId, kind: 'more-alerts', label: `+${hidden} alertas`, caption, href: `/alertas?incidentId=${encodeURIComponent(incident.id)}` });
    link(moreId, incidentId);
  }

  for (const host of incident.hosts) {
    const hostId = `host:${host.hostId}`;
    add({ id: hostId, kind: 'host', label: host.displayName, caption: 'Host', href: `/hosts/${host.hostId}` });
    // A host with no alert on the graph is involved by declaration only.
    if (!edges.some((edge) => edge.from === hostId)) link(hostId, incidentId, true);
  }
  for (const rule of incident.detectionRules) {
    const ruleId = `rule:${rule.ruleId}`;
    add({ id: ruleId, kind: 'rule', label: rule.name, caption: 'Regra', href: `/regras/${rule.ruleId}`, severity: rule.severity });
    if (!edges.some((edge) => edge.from === ruleId)) link(ruleId, incidentId, true);
  }
  for (const investigation of timeline.investigations) {
    const id = `investigation:${investigation.investigationId}`;
    add({ id, kind: 'investigation', label: investigation.title, caption: 'Investigação', href: `/investigacoes/${investigation.investigationId}` });
    link(incidentId, id);
  }

  // Layout: one column per kind present, each column centred on the tallest one.
  const L = GRAPH_LAYOUT;
  const kindOfColumn = (kind: GraphNodeKind): GraphNodeKind => (kind === 'more-alerts' ? 'alert' : kind);
  const present = COLUMN_ORDER.filter((column) => [...drafts.values()].some((node) => kindOfColumn(node.kind) === column.kind));
  const columns: GraphColumn[] = present.map((column, index) => ({ ...column, x: L.side + index * (L.nodeWidth + L.columnGap) }));
  const members = columns.map((column) => [...drafts.values()].filter((node) => kindOfColumn(node.kind) === column.kind));
  const tallest = Math.max(...members.map((list) => list.length));
  const columnHeight = (count: number) => count * L.nodeHeight + Math.max(0, count - 1) * L.rowGap;
  const bodyHeight = columnHeight(tallest);

  const nodes: GraphNode[] = [];
  const columnOf = new Map<string, number>();
  members.forEach((list, index) => {
    const offset = L.top + (bodyHeight - columnHeight(list.length)) / 2;
    list.forEach((node, row) => {
      nodes.push({ ...node, x: columns[index]?.x ?? 0, y: offset + row * (L.nodeHeight + L.rowGap) });
      columnOf.set(node.id, index);
    });
  });

  return {
    nodes,
    edges: edges.map((edge) => ({ ...edge, id: `${edge.from}->${edge.to}`, column: columnOf.get(edge.from) ?? 0 })),
    columns,
    width: L.side * 2 + columns.length * L.nodeWidth + Math.max(0, columns.length - 1) * L.columnGap,
    height: L.top + bodyHeight + L.side,
  };
}

/**
 * Everything that led to a node and everything it led to: upstream along incoming edges, downstream
 * along outgoing ones. Walking both ways from every node would light the whole graph through the
 * incident; lineage keeps the highlight to one causal chain.
 */
export function lineageOf(graph: Pick<IncidentGraph, 'edges'>, nodeId: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([nodeId]);
  const edges = new Set<string>();
  const walk = (start: string, forward: boolean) => {
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const edge of graph.edges) {
        const [from, to] = forward ? [edge.from, edge.to] : [edge.to, edge.from];
        if (from !== current) continue;
        edges.add(edge.id);
        if (!nodes.has(to)) {
          nodes.add(to);
          queue.push(to);
        }
      }
    }
  };
  walk(nodeId, true);
  walk(nodeId, false);
  return { nodes, edges };
}
