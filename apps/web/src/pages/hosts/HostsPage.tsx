import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { HostStatusBadge } from '../../features/hosts/HostStatusBadge';
import { formatDate } from '../../features/hosts/host-format';
import { useHostList } from '../../features/hosts/hosts-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { HOSTS_PAGE_SIZE, readListParams } from './host-route-params';

/** Paginated, searchable list. Page and search live in the URL (refresh, share, back/forward). */
export function HostsPage() {
  const { activeWorkspace } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const { page, q } = readListParams(searchParams);
  const [draft, setDraft] = useState(q);
  const list = useHostList(activeWorkspace?.id, { page, pageSize: HOSTS_PAGE_SIZE, q: q || undefined });

  const goTo = (next: { page?: number; q?: string }) => {
    const params = new URLSearchParams();
    const nextQ = next.q ?? q;
    const nextPage = next.page ?? page;
    if (nextQ) params.set('q', nextQ);
    if (nextPage > 1) params.set('page', String(nextPage));
    setSearchParams(params);
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    goTo({ q: draft.trim(), page: 1 });
  };

  const total = list.data?.pagination.total ?? 0;
  const items = list.data?.items ?? [];

  return (
    <main className="content">
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">{activeWorkspace?.name}</p>
          <h1 className="title">Hosts</h1>
          {list.data && (
            <p className="muted small" aria-live="polite">
              {q ? `${total} ${total === 1 ? 'resultado' : 'resultados'} para “${q}”` : `${total} ${total === 1 ? 'host cadastrado' : 'hosts cadastrados'}`}
            </p>
          )}
        </div>
        <Link to="/hosts/novo" className="button button--primary">
          Adicionar host
        </Link>
      </header>

      <form className="search" role="search" onSubmit={submitSearch}>
        <label className="visually-hidden" htmlFor="host-search">
          Buscar hosts
        </label>
        <input
          id="host-search"
          type="search"
          placeholder="Buscar por nome ou descrição"
          value={draft}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="button">
          Buscar
        </button>
        {q && (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setDraft('');
              goTo({ q: '', page: 1 });
            }}
          >
            Limpar
          </button>
        )}
      </form>

      {list.isPending && <p className="muted">Carregando hosts…</p>}
      {list.isError && (
        <p className="notice notice--error" role="alert">
          Não foi possível carregar os hosts agora. Tente novamente.
        </p>
      )}

      {list.data && total === 0 && !q && (
        <EmptyState
          title="Nenhum host cadastrado neste workspace."
          description="Adicione uma máquina para preparar o monitoramento pelo Aegis. O Collector será pareado em uma etapa futura."
          action={
            <Link to="/hosts/novo" className="button button--primary">
              Adicionar host
            </Link>
          }
        />
      )}
      {list.data && total === 0 && q && (
        <EmptyState title="Nenhum host encontrado." description="Tente outro termo ou limpe a busca." />
      )}
      {list.data && total > 0 && items.length === 0 && (
        <EmptyState
          title="Esta página não existe."
          description="A lista tem menos páginas do que o endereço indica."
          action={
            <button type="button" className="button" onClick={() => goTo({ page: 1 })}>
              Ir para a primeira página
            </button>
          }
        />
      )}

      {items.length > 0 && (
        <ul className="host-list" aria-label="Hosts" aria-busy={list.isFetching}>
          {items.map((host) => (
            <li key={host.id}>
              <Link to={`/hosts/${host.id}`} className="host-row">
                <span className="host-row__main">
                  <span className="host-row__name">{host.displayName}</span>
                  {host.description && <span className="host-row__description">{host.description}</span>}
                </span>
                <span className="host-row__meta">
                  <HostStatusBadge state={host.connectionState} />
                  <span className="host-row__telemetry">{host.lastSeenAt ? null : 'Nenhuma telemetria recebida'}</span>
                </span>
                <span className="host-row__date">Criado em {formatDate(host.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {list.data && (
        <Pagination
          page={page}
          totalPages={list.data.pagination.totalPages}
          disabled={list.isFetching}
          onPageChange={(next) => goTo({ page: next })}
        />
      )}
    </main>
  );
}
