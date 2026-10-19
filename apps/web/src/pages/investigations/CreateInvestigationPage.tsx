import { useNavigate } from 'react-router-dom';
import { InvestigationForm } from '../../features/investigations/InvestigationForm';
import { useCreateInvestigation } from '../../features/investigations/investigations-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';

export function CreateInvestigationPage() {
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const createInvestigation = useCreateInvestigation(activeWorkspace?.id ?? '');

  return (
    <main className="content content--medium">
      <header className="page-header">
        <p className="eyebrow">{activeWorkspace?.name}</p>
        <h1 className="title">Nova investigação</h1>
      </header>
      <InvestigationForm
        workspaceId={activeWorkspace?.id}
        footnote={<p className="muted small">A investigação começa com status “Aberta” e sem conclusão.</p>}
        submitLabel="Abrir investigação"
        pendingLabel="Abrindo…"
        cancelTo="/investigacoes"
        onSubmit={async (body) => {
          const investigation = await createInvestigation.mutateAsync(body);
          navigate(`/investigacoes/${investigation.id}`, { replace: true, state: { created: true } });
        }}
      />
    </main>
  );
}
