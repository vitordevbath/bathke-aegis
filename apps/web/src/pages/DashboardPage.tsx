import { Brand } from '../components/Brand';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';
import { useApiHealth } from '../features/health/use-api-health';
import type { ComponentState, SystemComponent } from '../types/system-status';

export function DashboardPage() {
  const health = useApiHealth();
  const apiState: ComponentState = health.isPending ? 'checking' : health.data?.status === 'ok' ? 'online' : 'offline';

  const components: SystemComponent[] = [
    { name: 'API', state: apiState },
    { name: 'Collector', state: 'not-configured' },
    { name: 'Detection Engine', state: 'not-configured' },
    { name: 'AI', state: 'not-configured' },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <StatusBadge state={apiState} />
      </header>
      <main className="content">
        <p className="eyebrow">Experimental XDR / SIEM Platform</p>
        {/* Static zeros until the Hosts / Events / Incidents / Investigations APIs exist. */}
        <section className="grid grid--metrics" aria-label="Overview">
          <MetricCard label="Hosts" value={0} />
          <MetricCard label="Events" value={0} />
          <MetricCard label="Incidents" value={0} />
          <MetricCard label="Investigations" value={0} />
        </section>
        <section className="surface" aria-labelledby="system-status">
          <h2 id="system-status" className="section-title">
            System Status
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
    </div>
  );
}
