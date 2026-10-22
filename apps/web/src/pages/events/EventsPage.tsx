import { Link, useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE } from '@aegis/contracts';
import { EVENT_CATEGORIES, EVENT_TYPES, EVENT_TYPES_BY_CATEGORY } from '@aegis/domain';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { CATEGORY_LABELS, TYPE_LABELS, formatInstant } from '../../features/events/event-labels';
import { useEventList } from '../../features/events/events-api';
import { useHostList } from '../../features/hosts/hosts-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { EVENTS_PAGE_SIZE, readEventListParams, toInstant, writeEventListParams, type EventListUrlState } from './event-route-params';

/** Read-only timeline of normalized telemetry. There is no "new event": events only arrive through ingestion. */
export function EventsPage() {
  const { activeWorkspace } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readEventListParams(searchParams);
  const hosts = useHostList(activeWorkspace?.id, { page: 1, pageSize: MAX_PAGE_SIZE });
  const list = useEventList(activeWorkspace?.id, {
    page: state.page,
    pageSize: EVENTS_PAGE_SIZE,
    hostId: state.hostId,
    category: state.category,
    eventType: state.eventType,
    from: toInstant(state.from, 'start'),
    to: toInstant(state.to, 'end'),
  });

  const update = (changes: Partial<EventListUrlState>) => setSearchParams(writeEventListParams({ ...state, page: 1, ...changes }));
  const filtered = Boolean(state.hostId || state.category || state.eventType || state.from || state.to);
  const types = state.category ? EVENT_TYPES_BY_CATEGORY[state.category] : EVENT_TYPES;
  const rangeInvalid = Boolean(state.from && state.to && state.from > state.to);
  // With an invalid range the API answers 400: show the hint, not stale results.
  const data = rangeInvalid ? undefined : list.data;
  const total = data?.pagination.total ?? 0;
  const items = data?.items ?? [];

  return (
    <main className="content">
      <header className="page-header">
        <p className="eyebrow">{activeWorkspace?.name}</p>
        <h1 className="title">Eventos</h1>
        {data && (
          <p className="muted small" aria-live="polite">
            {total} {total === 1 ? 'evento' : 'eventos'} {filtered ? (total === 1 ? 'encontrado' : 'encontrados') : total === 1 ? 'armazenado' : 'armazenados'}
          </p>
        )}
      </header>

      <div className="toolbar">
        <div className="filters">
          <label className="filter">
            <span className="visually-hidden">Host</span>
            <select value={state.hostId ?? ''} onChange={(event) => update({ hostId: event.target.value || undefined })}>
              <option value="">Todos os hosts</option>
              {(hosts.data?.items ?? []).map((host) => (
                <option key={host.id} value={host.id}>
                  {host.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span className="visually-hidden">Categoria</span>
            <select
              value={state.category ?? ''}
              onChange={(event) => update({ category: (event.target.value || undefined) as EventListUrlState['category'], eventType: undefined })}
            >
              <option value="">Todas as categorias</option>
              {EVENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span className="visually-hidden">Tipo</span>
            <select value={state.eventType ?? ''} onChange={(event) => update({ eventType: (event.target.value || undefined) as EventListUrlState['eventType'] })}>
              <option value="">Todos os tipos</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="filter filter--date">
            <span>De</span>
            <input type="datetime-local" value={state.from} onChange={(event) => update({ from: event.target.value })} />
          </label>
          <label className="filter filter--date">
            <span>Até</span>
            <input type="datetime-local" value={state.to} onChange={(event) => update({ to: event.target.value })} />
          </label>
          {filtered && (
            <button type="button" className="button button--ghost" onClick={() => setSearchParams(new URLSearchParams())}>
              Limpar filtros
            </button>
          )}
        </div>
        {rangeInvalid && (
          <p className="notice notice--error" role="alert">
            A data final deve ser posterior à inicial.
          </p>
        )}
      </div>

      {list.isPending && !rangeInvalid && <p className="muted">Carregando eventos…</p>}
      {list.isError && !rangeInvalid && (
        <p className="notice notice--error" role="alert">
          Não foi possível carregar os eventos agora. Tente novamente.
        </p>
      )}

      {data && total === 0 && !filtered && (
        <EmptyState
          title="Nenhum evento recebido."
          description="Eventos aparecerão aqui quando telemetria for enviada ao Aegis. Nenhum Collector está pareado ainda; nesta etapa, eventos só chegam pela API de ingestão de laboratório."
        />
      )}
      {data && total === 0 && filtered && <EmptyState title="Nenhum evento encontrado." description="Ajuste os filtros." />}
      {data && total > 0 && items.length === 0 && (
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
        <ul className="rule-list" aria-label="Eventos" aria-busy={list.isFetching}>
          {items.map((event) => (
            <li key={event.id}>
              <Link to={`/eventos/${event.id}`} className="rule-row event-row">
                <time className="event-row__time mono" dateTime={event.occurredAt}>
                  {formatInstant(event.occurredAt)}
                </time>
                <span className="rule-row__main">
                  <span className="rule-row__name">{TYPE_LABELS[event.type]}</span>
                  <span className="rule-row__meta mono">{event.summary}</span>
                </span>
                <span className="event-row__host">{event.hostDisplayName}</span>
                <span className="event-row__category">{CATEGORY_LABELS[event.category]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <Pagination
          page={state.page}
          totalPages={data.pagination.totalPages}
          disabled={list.isFetching}
          onPageChange={(page) => setSearchParams(writeEventListParams({ ...state, page }))}
        />
      )}
    </main>
  );
}
