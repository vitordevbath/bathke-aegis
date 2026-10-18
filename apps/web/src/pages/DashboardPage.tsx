import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';
import { useApiHealth } from '../features/health/use-api-health';
import { useAuth } from '../features/auth/AuthContext';
import { ROLE_LABELS, WORKSPACE_KIND_LABELS } from '../features/auth/labels';
import type { ComponentState, SystemComponent } from '../types/system-status';

export function DashboardPage() {
  const { user, workspaces } = useAuth();
  const health = useApiHealth();
  const apiState: ComponentState = health.isPending ? 'checking' : health.data?.status === 'ok' ? 'online' : 'offline';
  const workspace = workspaces[0];
  const firstName = user?.name.split(' ')[0] ?? '';

  const components: SystemComponent[] = [
    { name: 'API', state: apiState },
    { name: 'Collector', state: 'not-configured' },
    { name: 'Detection Engine', state: 'not-configured' },
    { name: 'IA', state: 'not-configured' },
  ];

  return (
    <main className="content">
      <header className="page-header">
        <p className="eyebrow">Painel</p>
        <h1 className="title">Olá, {firstName}</h1>
      </header>

      {workspace && (
        <section className="surface workspace-card" aria-labelledby="workspace-title">
          <div>
            <p className="eyebrow">Workspace atual</p>
            <h2 id="workspace-title" className="workspace-card__name">
              {workspace.name}
            </h2>
          </div>
          <dl className="workspace-card__meta">
            <div>
              <dt>Tipo</dt>
              <dd>{WORKSPACE_KIND_LABELS[workspace.kind]}</dd>
            </div>
            <div>
              <dt>Seu papel</dt>
              <dd>{ROLE_LABELS[workspace.role]}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Real zeros: Hosts / Events / Incidents / Investigations APIs do not exist yet. */}
      <section className="grid grid--metrics" aria-label="Visão geral">
        <MetricCard label="Hosts" value={0} />
        <MetricCard label="Eventos" value={0} />
        <MetricCard label="Incidentes" value={0} />
        <MetricCard label="Investigações" value={0} />
      </section>
      <p className="muted small">Nenhum host conectado a este workspace ainda.</p>

      <section className="surface" aria-labelledby="system-status">
        <h2 id="system-status" className="section-title">
          Status do sistema
        </h2>
        <ul className="status-list">
          {components.map((component) => (
            <li key={component.name}>
              <span>{component.name}</span>
              <StatusBadge state={component.state} />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
