import { useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IncidentTimelineResponse } from '@aegis/contracts';
import { SEVERITY_LABELS } from '../../../lib/severity';
import { buildIncidentGraph, GRAPH_LAYOUT, lineageOf, type GraphEdge, type GraphNode } from './graph-model';

const LABEL_CHARS = 19;
const clip = (text: string) => (text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1).trimEnd()}…` : text);

function edgePath(edge: GraphEdge, byId: Map<string, GraphNode>): string {
  const from = byId.get(edge.from);
  const to = byId.get(edge.to);
  if (!from || !to) return '';
  const { nodeWidth, nodeHeight } = GRAPH_LAYOUT;
  const x1 = from.x + nodeWidth;
  const y1 = from.y + nodeHeight / 2;
  const x2 = to.x;
  const y2 = to.y + nodeHeight / 2;
  const bend = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function accessibleName(node: GraphNode): string {
  // An alert's label already names its severity.
  const severity = node.severity && node.kind !== 'alert' ? `, severidade ${SEVERITY_LABELS[node.severity].toLowerCase()}` : '';
  return `${node.caption}: ${node.label}${severity}`;
}

/**
 * How the incident's pieces connect (ADR-054). Pointing at or focusing a node lights its causal chain
 * and dims the rest; activating it opens that record. Solid lines are what the engine produced;
 * dashed lines are relations recorded by hand.
 */
export function IncidentGraph({ timeline }: { readonly timeline: IncidentTimelineResponse }) {
  const navigate = useNavigate();
  const graph = useMemo(() => buildIncidentGraph(timeline), [timeline]);
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);
  const [focus, setFocus] = useState<string | null>(null);
  const lit = useMemo(() => (focus ? lineageOf(graph, focus) : null), [graph, focus]);
  const { nodeWidth, nodeHeight } = GRAPH_LAYOUT;

  const open = (node: GraphNode) => {
    if (node.href) navigate(node.href);
  };
  const onKey = (event: KeyboardEvent, node: GraphNode) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open(node);
    }
  };
  const state = (lighted: boolean) => (lit ? (lighted ? ' is-lit' : ' is-dim') : '');
  const declared = graph.edges.some((edge) => edge.declared);

  return (
    <div className="graph">
      <div className="graph__scroll">
        <svg
          className="graph__canvas"
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          width={graph.width}
          height={graph.height}
          role="group"
          aria-label={`Relações do incidente: ${graph.nodes.length} itens ligados`}
        >
          {graph.columns.map((column) => (
            <text key={column.kind} className="graph__column" x={column.x} y={16}>
              {column.title}
            </text>
          ))}
          <g aria-hidden="true">
            {graph.edges.map((edge) => (
              <path
                key={edge.id}
                d={edgePath(edge, byId)}
                pathLength={1}
                className={`graph-edge graph-edge--c${edge.column}${edge.declared ? ' graph-edge--declared' : ''}${state(lit?.edges.has(edge.id) ?? false)}`}
              />
            ))}
          </g>
          {graph.nodes.map((node) => {
            const interactive = node.href !== null;
            return (
              <g
                key={node.id}
                className={`graph-node graph-node--${node.kind}${node.severity ? ` graph-node--${node.severity.toLowerCase()}` : ''}${state(lit?.nodes.has(node.id) ?? false)}`}
                transform={`translate(${node.x} ${node.y})`}
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'link' : undefined}
                aria-label={interactive ? accessibleName(node) : undefined}
                onMouseEnter={() => setFocus(node.id)}
                onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus(node.id)}
                onBlur={() => setFocus(null)}
                onClick={() => open(node)}
                onKeyDown={(event) => onKey(event, node)}
              >
                <title>{accessibleName(node)}</title>
                <rect className="graph-node__box" width={nodeWidth} height={nodeHeight} rx={8} />
                {node.severity && <rect className="graph-node__severity" x={0} y={8} width={3} height={nodeHeight - 16} rx={1.5} />}
                <text className="graph-node__caption" x={14} y={19}>
                  {clip(node.caption)}
                </text>
                <text className="graph-node__label" x={14} y={36}>
                  {clip(node.label)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="graph__legend muted small">
        <span className="graph__swipe">Arraste para o lado para ver todas as colunas. </span>
        Passe o mouse ou use Tab para seguir uma cadeia; Enter abre o registro.
        {declared && ' Linhas tracejadas são relações registradas à mão.'}
      </p>
    </div>
  );
}
