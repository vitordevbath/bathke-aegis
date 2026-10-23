import { Link, useParams } from 'react-router-dom';
import { CATEGORY_LABELS, TYPE_LABELS, formatInstant } from '../../features/events/event-labels';
import { EventTechnicalData } from '../../features/events/EventTechnicalData';
import { useEvent } from '../../features/events/events-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { EventNotFound } from './EventNotFound';

/** Read-only: events are immutable, so there is no edit or delete action. */
export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const event = useEvent(activeWorkspace?.id, eventId);

  if (event.error instanceof ApiError && event.error.status === 404) return <EventNotFound />;
  if (event.isError) {
    return (
      <main className="content content--narrow">
        <p className="notice notice--error" role="alert">
          Não foi possível carregar o evento agora. Tente novamente.
        </p>
      </main>
    );
  }
  if (!event.data) return <main className="content content--narrow muted">Carregando evento…</main>;

  const data = event.data;
  const normalized = { schemaVersion: data.schemaVersion, sourceEventId: data.sourceEventId, occurredAt: data.occurredAt, category: data.category, type: data.type, data: data.data };

  return (
    <main className="content content--narrow">
      <nav aria-label="Trilha" className="breadcrumb">
        <Link to="/eventos">Eventos</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{TYPE_LABELS[data.type]}</span>
      </nav>

      <header className="page-header">
        <p className="eyebrow">{CATEGORY_LABELS[data.category]}</p>
        <h1 className="title">{TYPE_LABELS[data.type]}</h1>
        <p className="muted small mono">{data.summary}</p>
      </header>

      <section className="surface" aria-labelledby="record-title">
        <h2 id="record-title" className="section-title">
          Registro
        </h2>
        <dl className="facts">
          <div>
            <dt>Host</dt>
            <dd>
              <Link to={`/hosts/${data.hostId}`}>{data.hostDisplayName}</Link>
            </dd>
          </div>
          <div>
            <dt>Categoria</dt>
            <dd>{CATEGORY_LABELS[data.category]}</dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd className="mono">{data.type}</dd>
          </div>
          <div>
            <dt>Versão do esquema</dt>
            <dd>{data.schemaVersion}</dd>
          </div>
          <div>
            <dt>Ocorrido em</dt>
            <dd>
              <time dateTime={data.occurredAt}>{formatInstant(data.occurredAt)}</time>
            </dd>
          </div>
          <div>
            <dt>Recebido em</dt>
            <dd>
              <time dateTime={data.ingestedAt}>{formatInstant(data.ingestedAt)}</time>
            </dd>
          </div>
          <div>
            <dt>Source Event ID</dt>
            <dd className="mono">{data.sourceEventId}</dd>
          </div>
        </dl>
      </section>

      <section className="surface" aria-labelledby="technical-title">
        <h2 id="technical-title" className="section-title">
          Dados técnicos
        </h2>
        <EventTechnicalData event={data} />
        <p className="muted small">Somente metadados: linha de comando, ambiente, conteúdo de arquivos e payload de rede não são coletados.</p>
      </section>

      <details className="surface definition-preview">
        <summary>Ver evento normalizado</summary>
        <pre>{JSON.stringify(normalized, null, 2)}</pre>
      </details>
    </main>
  );
}
