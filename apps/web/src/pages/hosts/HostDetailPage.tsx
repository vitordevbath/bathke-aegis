import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ConfirmAction } from '../../components/ConfirmAction';
import { HostCollectorSummary } from '../../features/hosts/HostCollectorSummary';
import { HostPairingPanel } from '../../features/hosts/HostPairingPanel';
import { HostStatusBadge } from '../../features/hosts/HostStatusBadge';
import { formatDateTime } from '../../features/hosts/host-format';
import { useDeleteHost, useHost } from '../../features/hosts/hosts-api';
import { useCanManage, useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { HostNotFound } from './HostNotFound';

export function HostDetailPage() {
  const canManage = useCanManage();
  const { hostId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as { created?: boolean; updated?: boolean };
  const host = useHost(activeWorkspace?.id, hostId);
  const deleteHost = useDeleteHost(activeWorkspace?.id ?? '', hostId);

  if (host.error instanceof ApiError && host.error.status === 404) return <HostNotFound />;
  if (host.isError) {
    return (
      <main className="content content--narrow">
        <p className="notice notice--error" role="alert">
          Não foi possível carregar o host agora. Tente novamente.
        </p>
      </main>
    );
  }
  if (!host.data) return <main className="content content--narrow muted">Carregando host…</main>;

  const data = host.data;

  return (
    <main className="content content--wide">
      <nav aria-label="Trilha" className="breadcrumb">
        <Link to="/hosts">Hosts</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{data.displayName}</span>
      </nav>

      <header className="page-header page-header--split">
        <div>
          <h1 className="title">{data.displayName}</h1>
          {data.description ? <p className="muted">{data.description}</p> : <p className="muted small">Sem descrição.</p>}
        </div>
        <HostStatusBadge state={data.connectionState} />
      </header>

      {(state.created || state.updated) && (
        <p className="notice notice--success" role="status">
          {state.created ? 'Host adicionado.' : 'Host atualizado.'}
        </p>
      )}

      <div className="detail-grid">
        <div className="detail-grid__main">
          {activeWorkspace && <HostCollectorSummary workspaceId={activeWorkspace.id} host={data} />}

          <section className="surface" aria-labelledby="record-title">
            <h2 id="record-title" className="section-title">
              Cadastro
            </h2>
            <dl className="facts">
              <div>
                <dt>Workspace</dt>
                <dd>{activeWorkspace?.name}</dd>
              </div>
              <div>
                <dt>Criado em</dt>
                <dd>{formatDateTime(data.createdAt)}</dd>
              </div>
              <div>
                <dt>Atualizado em</dt>
                <dd>{formatDateTime(data.updatedAt)}</dd>
              </div>
            </dl>
          </section>
        </div>
        <div className="detail-grid__side">
          {activeWorkspace && <HostPairingPanel workspaceId={activeWorkspace.id} hostId={data.id} canManage={canManage} />}
        </div>
      </div>

      {canManage && (
        <div className="detail-actions">
          <Link to={`/hosts/${data.id}/editar`} className="button">
            Editar
          </Link>
          <ConfirmAction
            triggerLabel="Excluir"
            title="Excluir este host?"
            description={
              data.agentId
                ? 'Este host está pareado com um Collector. Hosts que já foram pareados mantêm o histórico das credenciais para auditoria e não podem ser excluídos; para interromper o Collector, revogue a credencial.'
                : 'O cadastro será removido deste workspace. Hosts com telemetria, regras, incidentes ou histórico de credenciais não podem ser excluídos.'
            }
            confirmLabel="Excluir host"
            pendingLabel="Excluindo…"
            onConfirm={async () => {
              await deleteHost.mutateAsync();
              navigate('/hosts', { replace: true });
            }}
          />
        </div>
      )}
      {deleteHost.isError && (
        <p className="notice notice--error" role="alert">
          {/* 409: rules, incidents, events or credentials refer to the host — the API message says what to do. */}
          {deleteHost.error instanceof ApiError && deleteHost.error.status === 409
            ? deleteHost.error.message
            : 'Não foi possível excluir o host agora. Tente novamente.'}
        </p>
      )}
    </main>
  );
}
