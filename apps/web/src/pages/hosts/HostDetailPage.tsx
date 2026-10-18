import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ConfirmAction } from '../../components/ConfirmAction';
import { HostStatusBadge } from '../../features/hosts/HostStatusBadge';
import { formatDateTime } from '../../features/hosts/host-format';
import { useDeleteHost, useHost } from '../../features/hosts/hosts-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { HostNotFound } from './HostNotFound';

const NOT_REPORTED = 'Ainda não informado';

export function HostDetailPage() {
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
  const os = [data.osName, data.osVersion].filter(Boolean).join(' ');

  return (
    <main className="content content--narrow">
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

      <section className="surface" aria-labelledby="collector-title">
        <h2 id="collector-title" className="section-title">
          Collector e telemetria
        </h2>
        <p className="muted small">Estes dados serão informados pelo Aegis Collector após o pareamento. Não podem ser editados.</p>
        <dl className="facts">
          <div>
            <dt>Collector</dt>
            <dd>{data.agentId ? 'Pareado' : 'Não pareado'}</dd>
          </div>
          <div>
            <dt>Hostname</dt>
            <dd>{data.hostname ?? NOT_REPORTED}</dd>
          </div>
          <div>
            <dt>Sistema operacional</dt>
            <dd>{os || NOT_REPORTED}</dd>
          </div>
          <div>
            <dt>Arquitetura</dt>
            <dd>{data.architecture ?? 'Ainda não informada'}</dd>
          </div>
          <div>
            <dt>Último contato</dt>
            <dd>{data.lastSeenAt ? formatDateTime(data.lastSeenAt) : 'Nunca'}</dd>
          </div>
        </dl>
      </section>

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

      <div className="detail-actions">
        <Link to={`/hosts/${data.id}/editar`} className="button">
          Editar
        </Link>
        <ConfirmAction
          triggerLabel="Excluir"
          title="Excluir este host?"
          description="O cadastro será removido deste workspace. Nesta etapa ainda não há telemetria associada a ele."
          confirmLabel="Excluir host"
          pendingLabel="Excluindo…"
          onConfirm={async () => {
            await deleteHost.mutateAsync();
            navigate('/hosts', { replace: true });
          }}
        />
      </div>
      {deleteHost.isError && (
        <p className="notice notice--error" role="alert">
          Não foi possível excluir o host agora. Tente novamente.
        </p>
      )}
    </main>
  );
}
