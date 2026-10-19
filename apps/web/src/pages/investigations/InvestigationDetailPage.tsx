import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ConfirmAction } from '../../components/ConfirmAction';
import { SeverityBadge } from '../../components/SeverityBadge';
import { formatDateTime } from '../../features/hosts/host-format';
import { IncidentStatusBadge } from '../../features/incidents/IncidentStatusBadge';
import { InvestigationLifecycleActions } from '../../features/investigations/InvestigationLifecycleActions';
import { InvestigationStatusBadge } from '../../features/investigations/InvestigationStatusBadge';
import { STATUS_LABELS } from '../../features/investigations/investigation-labels';
import { toStatusRequest, useDeleteInvestigation, useInvestigation, useUpdateInvestigation } from '../../features/investigations/investigations-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { InvestigationNotFound } from './InvestigationNotFound';

/** A 4xx carries a user-safe message (e.g. a refused transition or missing conclusion); anything else stays generic. */
const messageOf = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== 'UNKNOWN' ? error.message : fallback;

export function InvestigationDetailPage() {
  const { investigationId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as { created?: boolean; updated?: boolean };
  const investigation = useInvestigation(activeWorkspace?.id, investigationId);
  const updateInvestigation = useUpdateInvestigation(activeWorkspace?.id ?? '', investigationId);
  const deleteInvestigation = useDeleteInvestigation(activeWorkspace?.id ?? '', investigationId);

  if (investigation.error instanceof ApiError && investigation.error.status === 404) return <InvestigationNotFound />;
  if (investigation.isError) {
    return (
      <main className="content content--narrow">
        <p className="notice notice--error" role="alert">
          Não foi possível carregar a investigação agora. Tente novamente.
        </p>
      </main>
    );
  }
  if (!investigation.data) return <main className="content content--narrow muted">Carregando investigação…</main>;

  const data = investigation.data;
  const closed = data.status === 'CLOSED';

  return (
    <main className="content content--narrow">
      <nav aria-label="Trilha" className="breadcrumb">
        <Link to="/investigacoes">Investigações</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{data.title}</span>
      </nav>

      <header className="page-header page-header--split">
        <h1 className="title">{data.title}</h1>
        <InvestigationStatusBadge status={data.status} />
      </header>

      {(state.created || state.updated) && (
        <p className="notice notice--success" role="status">
          {state.created ? 'Investigação aberta.' : 'Investigação atualizada.'}
        </p>
      )}

      <section className="surface rule-section" aria-labelledby="lifecycle-title">
        <h2 id="lifecycle-title" className="section-title">
          Status · {STATUS_LABELS[data.status]}
        </h2>
        {closed ? (
          <p className="muted small">Encerrada é definitivo: a investigação fica somente leitura.</p>
        ) : (
          <InvestigationLifecycleActions
            // Remount after each save so the closing panel starts from the stored draft.
            key={data.updatedAt}
            available={data.availableTransitions}
            conclusion={data.conclusion}
            pending={updateInvestigation.isPending}
            onTransition={(status, conclusion) => updateInvestigation.mutate(toStatusRequest(data, status, conclusion ?? data.conclusion))}
          />
        )}
        {updateInvestigation.isError && (
          <p className="notice notice--error" role="alert">
            {messageOf(updateInvestigation.error, 'Não foi possível alterar o status agora. Tente novamente.')}
          </p>
        )}
      </section>

      <section className="surface" aria-labelledby="description-title">
        <h2 id="description-title" className="section-title">
          Descrição
        </h2>
        {data.description ? <p className="plain-text">{data.description}</p> : <p className="muted small">Sem descrição.</p>}
      </section>

      <section className="surface" aria-labelledby="incidents-title">
        <h2 id="incidents-title" className="section-title">
          Incidentes relacionados · {data.incidentCount}
        </h2>
        <ul className="target-summary">
          {data.incidents.map((incident) => (
            <li key={incident.incidentId}>
              <Link to={`/incidentes/${incident.incidentId}`}>{incident.title}</Link>
              <span className="badges">
                <SeverityBadge severity={incident.severity} />
                <IncidentStatusBadge status={incident.status} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface" aria-labelledby="conclusion-title">
        <h2 id="conclusion-title" className="section-title">
          {closed ? 'Conclusão' : 'Conclusão preliminar'}
        </h2>
        {data.conclusion ? <p className="plain-text">{data.conclusion}</p> : <p className="muted small">Ainda não definida.</p>}
      </section>

      <section className="surface" aria-labelledby="record-title">
        <h2 id="record-title" className="section-title">
          Registro
        </h2>
        <dl className="facts">
          <div>
            <dt>Criada em</dt>
            <dd>{formatDateTime(data.createdAt)}</dd>
          </div>
          <div>
            <dt>Atualizada em</dt>
            <dd>{formatDateTime(data.updatedAt)}</dd>
          </div>
          {data.closedAt && (
            <div>
              <dt>Encerrada em</dt>
              <dd>{formatDateTime(data.closedAt)}</dd>
            </div>
          )}
        </dl>
      </section>

      <div className="detail-actions">
        {!closed && (
          <Link to={`/investigacoes/${data.id}/editar`} className="button">
            Editar
          </Link>
        )}
        <ConfirmAction
          triggerLabel="Excluir"
          title="Excluir esta investigação?"
          description="Neste estágio o registro é removido definitivamente, junto com os vínculos com incidentes. Os incidentes continuam registrados."
          confirmLabel="Excluir investigação"
          pendingLabel="Excluindo…"
          onConfirm={async () => {
            await deleteInvestigation.mutateAsync();
            navigate('/investigacoes', { replace: true });
          }}
        />
      </div>
      {deleteInvestigation.isError && (
        <p className="notice notice--error" role="alert">
          {messageOf(deleteInvestigation.error, 'Não foi possível excluir a investigação agora. Tente novamente.')}
        </p>
      )}
    </main>
  );
}
