import { Link } from 'react-router-dom';
import { MAX_PAGE_SIZE, type HostResponse, type IncidentSummary } from '@aegis/contracts';
import { SEVERITIES } from '@aegis/domain';
import { MetricCard } from '../components/MetricCard';
import { SeverityBadge } from '../components/SeverityBadge';
import { StatusBadge } from '../components/StatusBadge';
import { useApiHealth } from '../features/health/use-api-health';
import { useAuth } from '../features/auth/AuthContext';
import { useWorkspace } from '../features/workspaces/WorkspaceContext';
import { useHostList } from '../features/hosts/hosts-api';
import { HostStatusBadge } from '../features/hosts/HostStatusBadge';
import { useIncidentList } from '../features/incidents/incidents-api';
import { IncidentStatusBadge } from '../features/incidents/IncidentStatusBadge';
import { useInvestigationList } from '../features/investigations/investigations-api';
import { useEventList } from '../features/events/events-api';
import { useRuleList } from '../features/rules/rules-api';
import { TYPE_LABELS } from '../features/events/event-labels';
import { ROLE_LABELS, WORKSPACE_KIND_LABELS } from '../features/auth/labels';
import { formatRelative } from '../lib/relative-time';
import type { ComponentState, SystemComponent } from '../types/system-status';

const ATTENTION_LIMIT = 5;
const HOST_PREVIEW_LIMIT = 6;
const RECENT_EVENTS = 5;

/** Most severe first, then most recent. */
const bySeverityThenDate = (a: IncidentSummary, b: IncidentSummary) =>
  SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

/** Hosts that need a look come first: lost contact, paired but silent, online, never paired. */
const HOST_ORDER: Record<HostResponse['connectionState'], number> = { OFFLINE: 0, PAIRED: 1, ONLINE: 2, UNPAIRED: 3 };

/**
 * The Collector row reflects real communication: online when at least one host sent a recent
 * heartbeat, offline when hosts are paired but none is talking, not configured when nothing is paired.
 */
export function collectorState(hosts: readonly HostResponse[] | undefined): ComponentState {
  if (!hosts) return 'checking';
  if (hosts.some((host) => host.connectionState === 'ONLINE')) return 'online';
  if (hosts.some((host) => host.connectionState !== 'UNPAIRED')) return 'offline';
  return 'not-configured';
}

export function DashboardPage() {
  const { user } = useAuth();
  const { activeWorkspace: workspace } = useWorkspace();
  const workspaceId = workspace?.id;
  const health = useApiHealth();
  // No summary endpoint: totals come from `pagination.total`; host states are counted over the
  // first MAX_PAGE_SIZE hosts, which covers the personal and laboratory workspaces of this phase.
  const hosts = useHostList(workspaceId, { page: 1, pageSize: MAX_PAGE_SIZE });
  const rules = useRuleTotal(workspaceId);
  const open = useIncidentList(workspaceId, { page: 1, pageSize: MAX_PAGE_SIZE, status: 'OPEN' });
  const investigating = useIncidentList(workspaceId, { page: 1, pageSize: MAX_PAGE_SIZE, status: 'INVESTIGATING' });
  const openInvestigations = useInvestigationList(workspaceId, { page: 1, pageSize: 1, status: 'OPEN' });
  const runningInvestigations = useInvestigationList(workspaceId, { page: 1, pageSize: 1, status: 'IN_PROGRESS' });
  const events = useEventList(workspaceId, { page: 1, pageSize: RECENT_EVENTS });

  const hostItems = hosts.data?.items;
  const online = hostItems?.filter((host) => host.connectionState === 'ONLINE').length ?? 0;
  const silent = hostItems?.filter((host) => host.connectionState === 'OFFLINE' || host.connectionState === 'PAIRED').length ?? 0;
  const activeIncidents = [...(open.data?.items ?? []), ...(investigating.data?.items ?? [])].sort(bySeverityThenDate);
  const activeIncidentTotal = open.data && investigating.data ? open.data.pagination.total + investigating.data.pagination.total : undefined;
  const critical = activeIncidents.filter((incident) => incident.severity === 'CRITICAL').length;
  const activeInvestigations =
    openInvestigations.data && runningInvestigations.data ? openInvestigations.data.pagination.total + runningInvestigations.data.pagination.total : undefined;
  const latestEvent = events.data?.items[0];

  const apiState: ComponentState = health.isPending ? 'checking' : health.data?.status === 'ok' ? 'online' : 'offline';
  const components: SystemComponent[] = [
    { name: 'API', state: apiState },
    { name: 'Collector', state: collectorState(hostItems) },
    { name: 'Motor de detecção', state: 'not-configured' },
    { name: 'IA', state: 'not-configured' },
  ];
  const firstName = user?.name.split(' ')[0] ?? '';
  const hostPreview = [...(hostItems ?? [])].sort((a, b) => HOST_ORDER[a.connectionState] - HOST_ORDER[b.connectionState]).slice(0, HOST_PREVIEW_LIMIT);

  return (
    <main className="content content--wide">
      <header className="page-header">
        <h1 className="title">Olá, {firstName}</h1>
        {workspace && (
          <p className="muted small">
            {workspace.name} · {WORKSPACE_KIND_LABELS[workspace.kind]} · {ROLE_LABELS[workspace.role]}
          </p>
        )}
      </header>

      <section className="grid grid--kpi" aria-label="Visão geral">
        <MetricCard
          label="Hosts online"
          value={hosts.data ? `${online}/${hosts.data.pagination.total}` : '—'}
          hint={hosts.data ? (silent > 0 ? `${silent} pareado${silent === 1 ? '' : 's'} sem comunicação` : 'Nenhum host pareado em silêncio') : undefined}
          tone={silent > 0 ? 'warn' : undefined}
          to="/hosts"
        />
        <MetricCard
          label="Incidentes ativos"
          value={activeIncidentTotal ?? '—'}
          hint={critical > 0 ? `${critical} crítico${critical === 1 ? '' : 's'}` : 'Abertos ou em investigação'}
          tone={critical > 0 ? 'danger' : undefined}
          to="/incidentes"
        />
        <MetricCard label="Investigações ativas" value={activeInvestigations ?? '—'} hint="Abertas ou em andamento" to="/investigacoes" />
        <MetricCard
          label="Eventos armazenados"
          value={events.data ? events.data.pagination.total : '—'}
          hint={latestEvent ? `Último ${formatRelative(latestEvent.occurredAt)}` : 'Nenhum evento recebido'}
          to="/eventos"
        />
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-col">
          <section className="surface panel" aria-labelledby="attention-title">
            <header className="panel__header">
              <h2 id="attention-title" className="section-title">
                Precisa de atenção
              </h2>
              <Link className="inline-link small" to="/incidentes">
                Ver incidentes
              </Link>
            </header>
            {activeIncidents.length === 0 ? (
              <p className="muted small">{open.isPending ? 'Carregando…' : 'Nenhum incidente aberto ou em investigação.'}</p>
            ) : (
              <ul className="mini-list">
                {activeIncidents.slice(0, ATTENTION_LIMIT).map((incident) => (
                  <li key={incident.id}>
                    <Link className="mini-row" to={`/incidentes/${incident.id}`}>
                      <SeverityBadge severity={incident.severity} />
                      <span className="mini-row__title">{incident.title}</span>
                      <IncidentStatusBadge status={incident.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface panel" aria-labelledby="events-title">
            <header className="panel__header">
              <h2 id="events-title" className="section-title">
                Eventos recentes
              </h2>
              <Link className="inline-link small" to="/eventos">
                Ver todos
              </Link>
            </header>
            {(events.data?.items.length ?? 0) === 0 ? (
              <p className="muted small">{events.isPending ? 'Carregando…' : 'Nenhum evento recebido. Pareie um host para começar a receber telemetria.'}</p>
            ) : (
              <ul className="mini-list">
                {events.data?.items.map((event) => (
                  <li key={event.id}>
                    <Link className="mini-row mini-row--event" to={`/eventos/${event.id}`}>
                      <span className="mini-row__meta mono">{formatRelative(event.occurredAt)}</span>
                      <span className="mini-row__title">{TYPE_LABELS[event.type]}</span>
                      <span className="mini-row__meta">{event.hostDisplayName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="dashboard-col">
          <section className="surface panel" aria-labelledby="hosts-title">
            <header className="panel__header">
              <h2 id="hosts-title" className="section-title">
                Hosts
              </h2>
              <Link className="inline-link small" to="/hosts">
                Ver todos
              </Link>
            </header>
            {hostPreview.length === 0 ? (
              <p className="muted small">{hosts.isPending ? 'Carregando…' : 'Nenhum host cadastrado.'}</p>
            ) : (
              <ul className="mini-list">
                {hostPreview.map((host) => (
                  <li key={host.id}>
                    <Link className="mini-row mini-row--host" to={`/hosts/${host.id}`}>
                      <span className="mini-row__title">{host.displayName}</span>
                      <span className="mini-row__meta">{host.lastSeenAt ? formatRelative(host.lastSeenAt) : ''}</span>
                      <HostStatusBadge state={host.connectionState} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface panel" aria-labelledby="system-status">
            <header className="panel__header">
              <h2 id="system-status" className="section-title">
                Status da plataforma
              </h2>
            </header>
            <ul className="status-list">
              {components.map((component) => (
                <li key={component.name}>
                  <span>{component.name}</span>
                  <StatusBadge state={component.state} />
                </li>
              ))}
            </ul>
            <p className="muted small panel__foot">
              {rules !== undefined ? `${rules} regra${rules === 1 ? '' : 's'} configurada${rules === 1 ? '' : 's'}; ` : ''}o motor de detecção ainda não avalia
              eventos.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function useRuleTotal(workspaceId: string | undefined): number | undefined {
  return useRuleList(workspaceId, { page: 1, pageSize: 1 }).data?.pagination.total;
}
