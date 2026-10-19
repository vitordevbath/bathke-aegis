import { Link, useNavigate, useParams } from 'react-router-dom';
import { InvestigationForm } from '../../features/investigations/InvestigationForm';
import { investigationToForm } from '../../features/investigations/investigation-form-model';
import { useInvestigation, useUpdateInvestigation } from '../../features/investigations/investigations-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { InvestigationNotFound } from './InvestigationNotFound';

/** Separate edit screen (rubric), reusing the creation form plus the draft conclusion. Status is changed on the detail page. */
export function EditInvestigationPage() {
  const { investigationId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const investigation = useInvestigation(activeWorkspace?.id, investigationId);
  const updateInvestigation = useUpdateInvestigation(activeWorkspace?.id ?? '', investigationId);

  if (investigation.error instanceof ApiError && investigation.error.status === 404) return <InvestigationNotFound />;
  if (investigation.isError) {
    return (
      <main className="content content--medium">
        <p className="notice notice--error" role="alert">
          Não foi possível carregar a investigação agora. Tente novamente.
        </p>
      </main>
    );
  }
  if (!investigation.data) return <main className="content content--medium muted">Carregando investigação…</main>;

  const data = investigation.data;
  return (
    <main className="content content--medium">
      <header className="page-header">
        <p className="eyebrow">Editar investigação</p>
        <h1 className="title">{data.title}</h1>
      </header>
      {data.status === 'CLOSED' ? (
        <section className="surface">
          <p className="muted">Esta investigação está encerrada e não pode mais ser alterada.</p>
          <Link to={`/investigacoes/${data.id}`} className="button">
            Voltar para a investigação
          </Link>
        </section>
      ) : (
        <InvestigationForm
          workspaceId={activeWorkspace?.id}
          defaultValues={investigationToForm(data)}
          withConclusion
          submitLabel="Salvar alterações"
          pendingLabel="Salvando…"
          cancelTo={`/investigacoes/${investigationId}`}
          onSubmit={async (body) => {
            await updateInvestigation.mutateAsync(body);
            navigate(`/investigacoes/${investigationId}`, { replace: true, state: { updated: true } });
          }}
        />
      )}
    </main>
  );
}
