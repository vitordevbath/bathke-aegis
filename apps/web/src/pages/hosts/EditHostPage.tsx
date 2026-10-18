import { useNavigate, useParams } from 'react-router-dom';
import { HostForm } from '../../features/hosts/HostForm';
import { useHost, useUpdateHost } from '../../features/hosts/hosts-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { HostNotFound } from './HostNotFound';

/** Separate edit screen (rubric). Only administrative fields; collector facts are shown read-only on the detail page. */
export function EditHostPage() {
  const { hostId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const host = useHost(activeWorkspace?.id, hostId);
  const updateHost = useUpdateHost(activeWorkspace?.id ?? '', hostId);

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

  return (
    <main className="content content--narrow">
      <header className="page-header">
        <p className="eyebrow">Editar host</p>
        <h1 className="title">{host.data.displayName}</h1>
      </header>
      <HostForm
        defaultValues={{ displayName: host.data.displayName, description: host.data.description ?? '' }}
        submitLabel="Salvar alterações"
        pendingLabel="Salvando…"
        cancelTo={`/hosts/${hostId}`}
        onSubmit={async (details) => {
          await updateHost.mutateAsync(details);
          navigate(`/hosts/${hostId}`, { replace: true, state: { updated: true } });
        }}
      />
    </main>
  );
}
