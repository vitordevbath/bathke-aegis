import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { INCIDENT_ORIGINS, INCIDENT_STATUSES, SEVERITIES } from '@aegis/domain';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { SeverityBadge } from '../../components/SeverityBadge';
import { formatDateTime } from '../../features/hosts/host-format';
import { CorrelationNotice } from '../../features/incidents/CorrelationNotice';
import { IncidentStatusBadge } from '../../features/incidents/IncidentStatusBadge';
import { ORIGIN_LABELS, STATUS_LABELS } from '../../features/incidents/incident-labels';
import { useIncidentList } from '../../features/incidents/incidents-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { SEVERITY_LABELS } from '../../lib/severity';
import { INCIDENTS_PAGE_SIZE, readIncidentListParams, writeIncidentListParams, type IncidentListUrlState } from './incident-route-params';

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

export function IncidentsPage() {
  const { activeWorkspace } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readIncidentListParams(searchParams);
  const [draft, setDraft] = useState(state.q);
  const list = useIncidentList(activeWorkspace?.id, {
    page: state.page,
    pageSize: INCIDENTS_PAGE_SIZE,
    q: state.q || undefined,
    severity: state.severity,
    status: state.status,
    origin: state.origin,
  });

  const update = (changes: Partial<IncidentListUrlState>) => setSearchParams(writeIncidentListParams({ ...state, page: 1, ...changes }));
  const filtered = Boolean(state.q || state.severity || state.status || state.origin);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    update({ q: draft.trim() });
  };

  const total = list.data?.pagination.total ?? 0;
  const items = list.data?.items ?? [];

  return (
    <main className="content">
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">{activeWorkspace?.name}</p>
          <h1 className="title">Incidentes</h1>
          {list.data && (
            <p className="muted small" aria-live="polite">
              {total} {total === 1 ? 'incidente' : 'incidentes'}{' '}
              {filtered ? (total === 1 ? 'encontrado' : 'encontrados') : total === 1 ? 'registrado' : 'registrados'}
            </p>
          )}
        </div>
        <Link to="/incidentes/novo" className="button button--primary">
          Novo incidente
        </Link>
      </header>

      <CorrelationNotice />

      <div className="toolbar">
        <form className="search" role="search" onSubmit={submitSearch}>
          <label className="visually-hidden" htmlFor="incident-search">
            Buscar incidentes
          </label>
          <input
            id="incident-search"
            type="search"
            placeholder="Buscar por título ou descrição"
            value={draft}
            maxLength={160}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="button">
            Buscar
          </button>
        </form>
        <div className="filters">
          <label className="filter">
            <span className="visually-hidden">Status</span>
            <select value={state.status ?? ''} onChange={(event) => update({ status: (event.target.value || undefined) as IncidentListUrlState['status'] })}>
              <option value="">Todos os status</option>
              {INCIDENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span className="visually-hidden">Severidade</span>
            <select
              value={state.severity ?? ''}
              onChange={(event) => update({ severity: (event.target.value || undefined) as IncidentListUrlState['severity'] })}
            >
              <option value="">Todas as severidades</option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {SEVERITY_LABELS[severity]}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span className="visually-hidden">Origem</span>
            <select value={state.origin ?? ''} onChange={(event) => update({ origin: (event.target.value || undefined) as IncidentListUrlState['origin'] })}>
              <option value="">Todas as origens</option>
              {INCIDENT_ORIGINS.map((origin) => (
                <option key={origin} value={origin}>
                  {ORIGIN_LABELS[origin]}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setDraft('');
                setSearchParams(new URLSearchParams());
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {list.isPending && <p className="muted">Carregando incidentes…</p>}
      {list.isError && (
        <p className="notice notice--error" role="alert">
          Não foi possível carregar os incidentes agora. Tente novamente.
        </p>
      )}

      {list.data && total === 0 && !filtered && (
        <EmptyState
          title="Nenhum incidente registrado."
          description="Incidentes podem ser registrados manualmente enquanto o mecanismo automático de correlação ainda não está ativo."
          action={
            <Link to="/incidentes/novo" className="button button--primary">
              Novo incidente
            </Link>
          }
        />
      )}
      {list.data && total === 0 && filtered && <EmptyState title="Nenhum incidente encontrado." description="Ajuste a busca ou os filtros." />}
      {list.data && total > 0 && items.length === 0 && (
        <EmptyState
          title="Esta página não existe."
          description="A lista tem menos páginas do que o endereço indica."
          action={
            <button type="button" className="button" onClick={() => update({})}>
              Ir para a primeira página
            </button>
          }
        />
      )}

      {items.length > 0 && (
        <ul className="rule-list" aria-label="Incidentes" aria-busy={list.isFetching}>
          {items.map((incident) => (
            <li key={incident.id}>
              <Link to={`/incidentes/${incident.id}`} className="rule-row incident-row">
                <span className="rule-row__main">
                  <span className="rule-row__name">{incident.title}</span>
                  <span className="rule-row__meta">
                    {ORIGIN_LABELS[incident.origin]} · {count(incident.hostCount, 'host', 'hosts')} · {count(incident.ruleCount, 'regra', 'regras')} ·{' '}
                    {formatDateTime(incident.createdAt)}
                  </span>
                </span>
                <SeverityBadge severity={incident.severity} />
                <IncidentStatusBadge status={incident.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {list.data && (
        <Pagination
          page={state.page}
          totalPages={list.data.pagination.totalPages}
          disabled={list.isFetching}
          onPageChange={(page) => setSearchParams(writeIncidentListParams({ ...state, page }))}
        />
      )}
    </main>
  );
}
