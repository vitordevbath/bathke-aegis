import { useNavigate } from 'react-router-dom';
import { HostForm } from '../../features/hosts/HostForm';
import { useCreateHost } from '../../features/hosts/hosts-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';

export function CreateHostPage() {
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const createHost = useCreateHost(activeWorkspace?.id ?? '');

  return (
    <main className="content content--narrow">
      <header className="page-header">
        <p className="eyebrow">{activeWorkspace?.name}</p>
        <h1 className="title">Adicionar host</h1>
        <p className="muted small">Cadastre a máquina agora; o Collector será pareado em uma etapa futura.</p>
      </header>
      <HostForm
        submitLabel="Adicionar host"
        pendingLabel="Adicionando…"
        cancelTo="/hosts"
        onSubmit={async (details) => {
          const host = await createHost.mutateAsync(details);
          navigate(`/hosts/${host.id}`, { replace: true, state: { created: true } });
        }}
      />
    </main>
  );
}
