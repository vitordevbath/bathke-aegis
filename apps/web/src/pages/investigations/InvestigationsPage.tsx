import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { INVESTIGATION_STATUSES } from '@aegis/domain';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { formatDateTime } from '../../features/hosts/host-format';
import { InvestigationStatusBadge } from '../../features/investigations/InvestigationStatusBadge';
import { STATUS_LABELS } from '../../features/investigations/investigation-labels';
import { useInvestigationList } from '../../features/investigations/investigations-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import {
  INVESTIGATIONS_PAGE_SIZE,
  readInvestigationListParams,
  writeInvestigationListParams,
  type InvestigationListUrlState,
} from './investigation-route-params';

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

export function InvestigationsPage() {
  const { activeWorkspace } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readInvestigationListParams(searchParams);
  const [draft, setDraft] = useState(state.q);
  const list = useInvestigationList(activeWorkspace?.id, {
    page: state.page,
    pageSize: INVESTIGATIONS_PAGE_SIZE,
    q: state.q || undefined,
    status: state.status,
  });

  const update = (changes: Partial<InvestigationListUrlState>) => setSearchParams(writeInvestigationListParams({ ...state, page: 1, ...changes }));
  const filtered = Boolean(state.q || state.status);

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
          <h1 className="title">Investigações</h1>
          {list.data && (
            <p className="muted small" aria-live="polite">
              {total} {total === 1 ? 'investigação' : 'investigações'}{' '}
              {filtered ? (total === 1 ? 'encontrada' : 'encontradas') : total === 1 ? 'registrada' : 'registradas'}
            </p>
          )}
        </div>
        <Link to="/investigacoes/nova" className="button button--primary">
          Nova investigação
        </Link>
      </header>

      <div className="toolbar">
        <form className="search" role="search" onSubmit={submitSearch}>
          <label className="visually-hidden" htmlFor="investigation-search">
            Buscar investigações
          </label>
          <input
            id="investigation-search"
            type="search"
            placeholder="Buscar por título, descrição ou conclusão"
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
            <select
              value={state.status ?? ''}
              onChange={(event) => update({ status: (event.target.value || undefined) as InvestigationListUrlState['status'] })}
            >
              <option value="">Todos os status</option>
              {INVESTIGATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
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

      {list.isPending && <p className="muted">Carregando investigações…</p>}
      {list.isError && (
        <p className="notice notice--error" role="alert">
          Não foi possível carregar as investigações agora. Tente novamente.
        </p>
      )}

      {list.data && total === 0 && !filtered && (
        <EmptyState
          title="Nenhuma investigação aberta."
          description="Investigações agrupam incidentes relacionados para análise e conclusão humana."
          action={
            <Link to="/investigacoes/nova" className="button button--primary">
              Nova investigação
            </Link>
          }
        />
      )}
      {list.data && total === 0 && filtered && <EmptyState title="Nenhuma investigação encontrada." description="Ajuste a busca ou o filtro de status." />}
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
        <ul className="rule-list" aria-label="Investigações" aria-busy={list.isFetching}>
          {items.map((investigation) => (
            <li key={investigation.id}>
              <Link to={`/investigacoes/${investigation.id}`} className="rule-row investigation-row">
                <span className="rule-row__main">
                  <span className="rule-row__name">{investigation.title}</span>
                  <span className="rule-row__meta">
                    {count(investigation.incidentCount, 'incidente', 'incidentes')} · Criada em {formatDateTime(investigation.createdAt)}
                    {investigation.closedAt && <> · Encerrada em {formatDateTime(investigation.closedAt)}</>}
                  </span>
                </span>
                <InvestigationStatusBadge status={investigation.status} />
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
          onPageChange={(page) => setSearchParams(writeInvestigationListParams({ ...state, page }))}
        />
      )}
    </main>
  );
}
