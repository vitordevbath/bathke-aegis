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
 * `test/architecture-info.test.ts` checks these claims against the repository
 * (paths, tables, migrations, routes, the Collector crate).
 */
export const ARCHITECTURE: readonly ArchitectureComponent[] = [
  {
    name: 'Aegis Web',
    path: 'apps/web',
    status: 'CURRENT',
    summary:
      'React + TypeScript + Vite SPA: public site at / (own WebGL 2 contour field, lazily loaded chunk, ADR-050), login/cadastro, attention-first /dashboard (active incidents by severity, hosts without communication, recent events, Collector state derived from heartbeats), /perfil via the account button, CRUD screens for /hosts, /regras, /incidentes, /investigacoes, read-only /eventos; host detail shows Collector communication state, last heartbeat, events received, pairing code (generate/cancel), credential rotation/revocation and credential history',
  },
  {
    name: 'Aegis API',
    path: 'apps/api',
    status: 'CURRENT',
    summary:
      'Fastify + TypeScript, layered (presentation/application/domain/infrastructure). Auth: Argon2id + JWT HS256, GET/PUT /users/me. Per-workspace CRUD for hosts, detection rules (configuration only), incidents (manual) and investigations. Events: machine-authenticated ingestion (Event Contract v1, idempotent batches) and read-only queries. Machine identity: POST /agent/pair, pairing codes (create/cancel), credential rotation/revocation, POST …/hosts/:hostId/heartbeat (scope host:heartbeat); ONLINE/OFFLINE derived from last_seen_at; revocation re-checked inside the ingestion/heartbeat transaction',
  },
  { name: 'Contracts', path: 'packages/contracts', status: 'CURRENT', summary: 'Zod schemas and transport DTOs shared by web and api (auth, users, hosts, rules, incidents, investigations, events, machine identity, heartbeat)' },
  {
    name: 'Domain package',
    path: 'packages/domain',
    status: 'CURRENT',
    summary: 'Entity, DomainError hierarchy, Email/Cpf/PasswordPolicy, host rules and presence policy (heartbeat 30 s, online window 90 s), detection rule schema v1, incident and investigation lifecycles, Event Contract v1, machine scopes (events:ingest, host:heartbeat)',
  },
  { name: 'Aegis MCP', path: 'tools/aegis-mcp', status: 'CURRENT', summary: 'Restricted stdio MCP server: 7 fixed tools, path allowlist, secret guard and output redaction' },
  {
    name: 'MySQL',
    path: 'apps/api/drizzle',
    status: 'CURRENT',
    summary:
      'MySQL 8.4 (Compose service on internal network aegis_data), 12 versioned migrations (0000–0011) applied by the one-shot migrate service. Tables: users, workspaces, memberships, hosts, detection_rules, detection_rule_targets, incidents, incident_hosts, incident_detection_rules, investigations, investigation_incidents, events (append-only), pairing_challenges, machine_credentials, rate_limit_counters (persistent pairing limits, HMAC-hashed client addresses)',
  },
  { name: 'Nginx', path: 'infra/nginx', status: 'CURRENT', summary: 'Single published port; / to web, /api/ to api; strict CSP and security headers; the API trusts exactly this one proxy hop' },
  {
    name: 'Aegis Collector',
    path: 'native/aegis-collector',
    status: 'CURRENT',
    summary:
      'Rust CLI run explicitly in the foreground on Linux (no root, no service install, no eBPF): pair (code read without echo), run, status, replace-credential, unpair. Reports SYSTEM_BOOT and SYSTEM_SERVICE_STATE_CHANGED (systemctl, fixed args), sends heartbeats, keeps a bounded SQLite queue with idempotent retries; credential in a 0600 file; TLS always verified',
  },
  { name: 'eBPF telemetry', path: 'native/ebpf', status: 'PLANNED', summary: 'Rust + Aya probes for process/file/network metadata; PROCESS and NETWORK events are not collected yet' },
  { name: 'Detection Engine', path: '-', status: 'PLANNED', summary: 'Evaluation of the stored detection rules over events; rules are configuration only today' },
  { name: 'Alerts and correlation', path: '-', status: 'PLANNED', summary: 'Alerts from rule matches and automatic incident correlation; incidents are manual today' },
  { name: 'Aegis Verified Core', path: 'native/spark-core', status: 'PLANNED', summary: 'Ada/SPARK incident state machine and severity policy, proved with GNATprove' },
  { name: 'x86-64 experiments', path: 'native/asm64', status: 'PLANNED', summary: 'NASM kernels with safe reference implementations and benchmarks' },
  { name: 'AI analysis', path: '-', status: 'PLANNED', summary: 'External API summarizing structured incident evidence; optional' },
];

export function architectureInfo(): string {
  const format = (status: ComponentStatus): string =>
    ARCHITECTURE.filter((component) => component.status === status)
      .map((component) => `- ${component.name} (${component.path}): ${component.summary}`)
      .join('\n');
  return [
    `CURRENT\n${format('CURRENT')}`,
    `PLANNED\n${format('PLANNED')}`,
    'Flow: Linux host → Aegis Collector (machine credential) → heartbeat + SYSTEM events → local SQLite queue → API → Event Store → Aegis Web.',
    'Rule: Aegis Labs (planned native/AI parts) must never prevent Aegis Core from running; Core images and builds do not need Rust.',
  ].join('\n\n');
}
