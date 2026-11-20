import { Link } from 'react-router-dom';
import { useAlertList } from './alerts-api';
import { formatRelative } from '../../lib/relative-time';

const PREVIEW = 5;

/** The latest alerts of one incident or one rule, with a link to the full filtered list (ADR-053). */
export function RelatedAlerts({ workspaceId, incidentId, ruleId }: { readonly workspaceId: string; readonly incidentId?: string; readonly ruleId?: string }) {
  const list = useAlertList(workspaceId, { page: 1, pageSize: PREVIEW, incidentId, ruleId }, { refetchInterval: 30_000 });
  const total = list.data?.pagination.total ?? 0;
  const filter = incidentId ? `incidentId=${encodeURIComponent(incidentId)}` : `ruleId=${encodeURIComponent(ruleId ?? '')}`;

  return (
    <section className="surface panel" aria-labelledby="related-alerts">
      <header className="panel__header">
        <h2 id="related-alerts" className="section-title">
          Alertas · {list.data ? total : '…'}
        </h2>
        {total > 0 && (
          <Link className="inline-link small" to={`/alertas?${filter}`}>
            Ver todos
          </Link>
        )}
      </header>
      {list.data && total === 0 && (
        <p className="muted small">{incidentId ? 'Nenhum alerta ligado a este incidente.' : 'Esta regra ainda não casou com nenhum evento.'}</p>
      )}
      {total > 0 && (
        <ul className="mini-list">
          {list.data?.items.map((alert) => (
            <li key={alert.id}>
              <Link className="mini-row mini-row--event" to={`/alertas/${alert.id}`}>
                <span className="mini-row__meta mono">{formatRelative(alert.createdAt)}</span>
                <span className="mini-row__title">{alert.event.summary}</span>
                <span className="mini-row__meta">{incidentId ? alert.host.displayName : (alert.incident?.title ?? alert.host.displayName)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
