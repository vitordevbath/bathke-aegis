import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { SeverityBadge } from '../../components/SeverityBadge';
import { useAlert } from '../../features/alerts/alerts-api';
import { TYPE_LABELS, formatInstant } from '../../features/events/event-labels';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';

/** One alert and everything it connects: rule, host, the matched event and the incident (ADR-053). Read-only. */
export function AlertDetailPage() {
  const { alertId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const alert = useAlert(activeWorkspace?.id, alertId);

  if (alert.error instanceof ApiError && alert.error.status === 404) {
    return (
      <main className="content content--narrow">
        <EmptyState
          title="Alerta não encontrado."
          description="Ele não existe neste workspace."
          action={
            <Link to="/alertas" className="button">
              Ver alertas
            </Link>
          }
        />
      </main>
    );
  }
  if (alert.isError) {
    return (
      <main className="content content--narrow">
        <p className="notice notice--error" role="alert">
          Não foi possível carregar o alerta agora. Tente novamente.
        </p>
      </main>
    );
  }
  if (!alert.data) return <main className="content content--narrow muted">Carregando alerta…</main>;
  const data = alert.data;

  return (
    <main className="content content--wide">
      <nav aria-label="Trilha" className="breadcrumb">
        <Link to="/alertas">Alertas</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{data.rule.name}</span>
      </nav>

      <header className="page-header page-header--split">
        <div>
          <h1 className="title">{data.rule.name}</h1>
          <p className="muted small">
            {data.host.displayName} · {data.event.summary}
          </p>
        </div>
        <SeverityBadge severity={data.severity} />
      </header>

      <div className="detail-grid">
        <div className="detail-grid__main">
          <section className="surface" aria-labelledby="alert-what">
            <h2 id="alert-what" className="section-title">
              O que aconteceu
            </h2>
            <dl className="facts">
              <div>
                <dt>Evento</dt>
                <dd>
                  <Link className="inline-link" to={`/eventos/${data.event.id}`}>
                    {TYPE_LABELS[data.event.type]}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Resumo</dt>
                <dd className="mono">{data.event.summary}</dd>
              </div>
              <div>
                <dt>Ocorrido em</dt>
                <dd>{formatInstant(data.occurredAt)}</dd>
              </div>
              <div>
                <dt>Alerta gerado em</dt>
                <dd>{formatInstant(data.createdAt)}</dd>
              </div>
            </dl>
            <p className="muted small facts-note">
              Alertas são registros permanentes do motor de detecção: não são editados nem excluídos. A triagem acontece no incidente.
            </p>
          </section>
        </div>
        <div className="detail-grid__side">
          <section className="surface" aria-labelledby="alert-links">
            <h2 id="alert-links" className="section-title">
              Relacionado
            </h2>
            <ul className="target-summary">
              <li>
                <span className="muted">Regra</span>
                <Link to={`/regras/${data.rule.id}`}>{data.rule.name}</Link>
              </li>
              <li>
                <span className="muted">Host</span>
                <Link to={`/hosts/${data.host.id}`}>{data.host.displayName}</Link>
              </li>
              <li>
                <span className="muted">Incidente</span>
                {data.incident ? <Link to={`/incidentes/${data.incident.id}`}>{data.incident.title}</Link> : <span className="muted">Excluído</span>}
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
