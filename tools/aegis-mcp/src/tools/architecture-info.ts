export type ComponentStatus = 'CURRENT' | 'PLANNED';

export interface ArchitectureComponent {
  readonly name: string;
  readonly path: string;
  readonly status: ComponentStatus;
  readonly summary: string;
}

/**
 * Source of truth for what exists vs. what is planned. Keep in sync with
 * docs/ARCHITECTURE.md; never mark a component CURRENT before it runs.
 */
export const ARCHITECTURE: readonly ArchitectureComponent[] = [
  { name: 'Aegis Web', path: 'apps/web', status: 'CURRENT', summary: 'React + TypeScript + Vite SPA; routes /, /login (placeholder), /dashboard' },
  { name: 'Aegis API', path: 'apps/api', status: 'CURRENT', summary: 'Fastify + TypeScript; GET /health; Drizzle schema prepared, not wired' },
  { name: 'Contracts', path: 'packages/contracts', status: 'CURRENT', summary: 'Transport types shared by web and api (HealthResponse)' },
  { name: 'Domain primitives', path: 'packages/domain', status: 'CURRENT', summary: 'Entity, DomainError base classes' },
  { name: 'Aegis MCP', path: 'tools/aegis-mcp', status: 'CURRENT', summary: 'Restricted MCP server with secret guard' },
  { name: 'MySQL', path: 'compose.yaml', status: 'CURRENT', summary: 'Compose service on internal network aegis_data; no schema migrated' },
  { name: 'Nginx', path: 'infra/nginx', status: 'CURRENT', summary: 'Single exposed entrypoint; / to web, /api/ to api' },
  { name: 'Aegis Collector', path: 'native/aegis-collector', status: 'PLANNED', summary: 'Rust user-space agent: normalize, batch, ship events' },
  { name: 'eBPF telemetry', path: 'native/ebpf', status: 'PLANNED', summary: 'Rust + Aya probes for process/file/network metadata' },
  { name: 'Aegis Verified Core', path: 'native/spark-core', status: 'PLANNED', summary: 'Ada/SPARK incident state machine and severity policy, proved with GNATprove' },
  { name: 'x86-64 experiments', path: 'native/asm64', status: 'PLANNED', summary: 'NASM kernels with safe reference implementations and benchmarks' },
  { name: 'AI analysis', path: '-', status: 'PLANNED', summary: 'External API summarizing structured incident evidence; optional' },
];

export function architectureInfo(): string {
  const format = (status: ComponentStatus): string =>
    ARCHITECTURE.filter((component) => component.status === status)
      .map((component) => `- ${component.name} (${component.path}): ${component.summary}`)
      .join('\n');
  return `CURRENT\n${format('CURRENT')}\n\nPLANNED\n${format('PLANNED')}\n\nRule: Aegis Labs (planned native/AI parts) must never prevent Aegis Core from running.`;
}
