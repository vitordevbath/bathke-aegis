import { Link, useSearchParams } from 'react-router-dom';
import { SEVERITIES, type Severity } from '@aegis/domain';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { SeverityBadge } from '../../components/SeverityBadge';
import { useAlertList } from '../../features/alerts/alerts-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { SEVERITY_LABELS } from '../../lib/severity';
import { formatRelative } from '../../lib/relative-time';

const PAGE_SIZE = 20;
const isSeverity = (value: string | null): value is Severity => SEVERITIES.includes(value as Severity);

/** Read-only list of what the detection engine raised (ADR-053). Filters live in the URL. */
export function AlertsPage() {
  const { activeWorkspace } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const severityParam = params.get('severity');
  const severity = isSeverity(severityParam) ? severityParam : undefined;
  const incidentId = params.get('incidentId') ?? undefined;
  const ruleId = params.get('ruleId') ?? undefined;
  const list = useAlertList(activeWorkspace?.id, { page, pageSize: PAGE_SIZE, severity, incidentId, ruleId }, { refetchInterval: 30_000 });
  const total = list.data?.pagination.total ?? 0;
  const items = list.data?.items ?? [];
  const filtered = Boolean(severity || incidentId || ruleId);

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  return (
    <main className="content">
      <header className="page-header">
        <p className="eyebrow">{activeWorkspace?.name}</p>
        <h1 className="title">Alertas</h1>
        {list.data && (
          <p className="muted small" aria-live="polite">
            {total} {total === 1 ? 'alerta' : 'alertas'}
            {filtered ? (total === 1 ? ' encontrado' : ' encontrados') : ''}
          </p>
        )}
      </header>

      <p className="engine-notice" role="note">
        <span className="engine-notice__dot engine-notice__dot--on" aria-hidden="true" />
        Cada evento recebido é avaliado pelas regras habilitadas. Alertas da mesma regra no mesmo host, em até 30 minutos, entram no mesmo incidente.
      </p>

      <div className="filters filters--bar filters--compact">
        <label className="filter">
          <span className="filter__label">Severidade</span>
          <select value={severity ?? ''} onChange={(event) => update({ severity: event.target.value || undefined })}>
            <option value="">Todas</option>
            {[...SEVERITIES].reverse().map((value) => (
              <option key={value} value={value}>
                {SEVERITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button type="button" className="button button--ghost" onClick={() => setParams(new URLSearchParams())}>
            Limpar filtros
          </button>
        )}
      </div>

      {list.isPending && <p className="muted">Carregando alertas…</p>}
      {list.isError && (
        <p className="notice notice--error" role="alert">
          Não foi possível carregar os alertas agora. Tente novamente.
        </p>
      )}
      {list.data && total === 0 && (
        <EmptyState
          title={filtered ? 'Nenhum alerta encontrado.' : 'Nenhum alerta ainda.'}
          description={
            filtered
              ? 'Ajuste os filtros.'
              : 'Alertas aparecem quando um evento recebido casa com uma regra habilitada. Crie ou habilite uma regra e aguarde a telemetria.'
          }
        />
      )}

      {items.length > 0 && (
        <ul className="host-list" aria-busy={list.isFetching}>
          {items.map((alert) => (
            <li key={alert.id}>
              <Link to={`/alertas/${alert.id}`} className="host-row alert-row">
                <span className="alert-row__time mono">{formatRelative(alert.createdAt)}</span>
                <span className="host-row__main">
                  <span className="host-row__name">{alert.rule.name}</span>
                  <span className="host-row__description">
                    {alert.host.displayName} · {alert.event.summary}
                  </span>
                </span>
                <SeverityBadge severity={alert.severity} />
                <span className="alert-row__incident">{alert.incident ? alert.incident.title : 'Sem incidente'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {list.data && <Pagination page={page} totalPages={list.data.pagination.totalPages} disabled={list.isFetching} onPageChange={(next) => update({ page: String(next) })} />}
    </main>
  );
}
