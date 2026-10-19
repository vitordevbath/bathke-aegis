import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ConfirmAction } from '../../components/ConfirmAction';
import { SeverityBadge } from '../../components/SeverityBadge';
import { HostStatusBadge } from '../../features/hosts/HostStatusBadge';
import { formatDateTime } from '../../features/hosts/host-format';
import { IncidentLifecycleActions } from '../../features/incidents/IncidentLifecycleActions';
import { IncidentStatusBadge } from '../../features/incidents/IncidentStatusBadge';
import { ORIGIN_LABELS, STATUS_LABELS } from '../../features/incidents/incident-labels';
import { toStatusRequest, useDeleteIncident, useIncident, useUpdateIncident } from '../../features/incidents/incidents-api';
import { RuleStatusBadge } from '../../features/rules/RuleStatusBadge';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { IncidentNotFound } from './IncidentNotFound';

/** A 4xx carries a user-safe message (e.g. a refused transition); anything else stays generic. */
const messageOf = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== 'UNKNOWN' ? error.message : fallback;

export function IncidentDetailPage() {
  const { incidentId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as { created?: boolean; updated?: boolean };
  const incident = useIncident(activeWorkspace?.id, incidentId);
  const updateIncident = useUpdateIncident(activeWorkspace?.id ?? '', incidentId);
  const deleteIncident = useDeleteIncident(activeWorkspace?.id ?? '', incidentId);

  if (incident.error instanceof ApiError && incident.error.status === 404) return <IncidentNotFound />;
  if (incident.isError) {
    return (
      <main className="content content--narrow">
        <p className="notice notice--error" role="alert">
          Não foi possível carregar o incidente agora. Tente novamente.
        </p>
      </main>
    );
  }
  if (!incident.data) return <main className="content content--narrow muted">Carregando incidente…</main>;

  const data = incident.data;
  const closed = data.status === 'CLOSED';

  return (
    <main className="content content--narrow">
      <nav aria-label="Trilha" className="breadcrumb">
        <Link to="/incidentes">Incidentes</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{data.title}</span>
      </nav>

      <header className="page-header page-header--split">
        <div>
          <h1 className="title">{data.title}</h1>
          <p className="muted small">Origem: {ORIGIN_LABELS[data.origin]}</p>
        </div>
        <div className="badges">
          <SeverityBadge severity={data.severity} />
          <IncidentStatusBadge status={data.status} />
        </div>
      </header>

      {(state.created || state.updated) && (
        <p className="notice notice--success" role="status">
          {state.created ? 'Incidente registrado.' : 'Incidente atualizado.'}
        </p>
      )}

      <section className="surface rule-section" aria-labelledby="lifecycle-title">
        <h2 id="lifecycle-title" className="section-title">
          Status · {STATUS_LABELS[data.status]}
        </h2>
        {closed ? (
          <p className="muted small">Encerrado é definitivo: o incidente fica somente leitura.</p>
        ) : (
          <IncidentLifecycleActions
            status={data.status}
            available={data.availableTransitions}
            pending={updateIncident.isPending}
            onTransition={(status) => updateIncident.mutate(toStatusRequest(data, status))}
          />
        )}
        {updateIncident.isError && (
          <p className="notice notice--error" role="alert">
            {messageOf(updateIncident.error, 'Não foi possível alterar o status agora. Tente novamente.')}
          </p>
        )}
      </section>

      <section className="surface" aria-labelledby="description-title">
        <h2 id="description-title" className="section-title">
          Descrição
        </h2>
        {data.description ? <p className="plain-text">{data.description}</p> : <p className="muted small">Sem descrição.</p>}
      </section>

      <section className="surface" aria-labelledby="hosts-title">
        <h2 id="hosts-title" className="section-title">
          Hosts envolvidos · {data.hostCount}
        </h2>
        <ul className="target-summary">
          {data.hosts.map((host) => (
            <li key={host.hostId}>
              <Link to={`/hosts/${host.hostId}`}>{host.displayName}</Link>
              <HostStatusBadge state={host.connectionState} />
            </li>
          ))}
        </ul>
      </section>

      <section className="surface" aria-labelledby="rules-title">
        <h2 id="rules-title" className="section-title">
          Regras relacionadas · {data.ruleCount}
        </h2>
        {data.detectionRules.length === 0 ? (
          <p className="muted small">Nenhuma regra relacionada.</p>
        ) : (
          <ul className="target-summary">
            {data.detectionRules.map((rule) => (
              <li key={rule.ruleId}>
                <Link to={`/regras/${rule.ruleId}`}>{rule.name}</Link>
                <span className="badges">
                  <SeverityBadge severity={rule.severity} />
                  <RuleStatusBadge enabled={rule.enabled} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Relação registrada manualmente; regras ainda não são executadas.</p>
      </section>

      <section className="surface" aria-labelledby="record-title">
        <h2 id="record-title" className="section-title">
          Registro
        </h2>
        <dl className="facts">
          <div>
            <dt>Origem</dt>
            <dd>{ORIGIN_LABELS[data.origin]}</dd>
          </div>
          <div>
            <dt>Criado em</dt>
            <dd>{formatDateTime(data.createdAt)}</dd>
          </div>
          <div>
            <dt>Atualizado em</dt>
            <dd>{formatDateTime(data.updatedAt)}</dd>
          </div>
          {data.resolvedAt && (
            <div>
              <dt>Resolvido em</dt>
              <dd>{formatDateTime(data.resolvedAt)}</dd>
            </div>
          )}
        </dl>
      </section>

      <div className="detail-actions">
        {!closed && (
          <Link to={`/incidentes/${data.id}/editar`} className="button">
            Editar
          </Link>
        )}
        <ConfirmAction
          triggerLabel="Excluir"
          title="Excluir este incidente?"
          description="Nesta etapa o registro é removido definitivamente, junto com as relações com hosts e regras. Hosts e regras continuam cadastrados."
          confirmLabel="Excluir incidente"
          pendingLabel="Excluindo…"
          onConfirm={async () => {
            await deleteIncident.mutateAsync();
            navigate('/incidentes', { replace: true });
          }}
        />
      </div>
      {deleteIncident.isError && (
        <p className="notice notice--error" role="alert">
          {messageOf(deleteIncident.error, 'Não foi possível excluir o incidente agora. Tente novamente.')}
        </p>
      )}
    </main>
  );
}
