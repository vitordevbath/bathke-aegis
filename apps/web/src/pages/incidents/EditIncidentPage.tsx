import { Link, useNavigate, useParams } from 'react-router-dom';
import { IncidentForm } from '../../features/incidents/IncidentForm';
import { incidentToForm } from '../../features/incidents/incident-form-model';
import { useIncident, useUpdateIncident } from '../../features/incidents/incidents-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { IncidentNotFound } from './IncidentNotFound';

/** Separate edit screen (rubric), reusing the creation form. Status is changed on the detail page. */
export function EditIncidentPage() {
  const { incidentId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const incident = useIncident(activeWorkspace?.id, incidentId);
  const updateIncident = useUpdateIncident(activeWorkspace?.id ?? '', incidentId);

  if (incident.error instanceof ApiError && incident.error.status === 404) return <IncidentNotFound />;
  if (incident.isError) {
    return (
      <main className="content content--medium">
        <p className="notice notice--error" role="alert">
          Não foi possível carregar o incidente agora. Tente novamente.
        </p>
      </main>
    );
  }
  if (!incident.data) return <main className="content content--medium muted">Carregando incidente…</main>;

  const data = incident.data;
  return (
    <main className="content content--medium">
      <header className="page-header">
        <p className="eyebrow">Editar incidente</p>
        <h1 className="title">{data.title}</h1>
      </header>
      {data.status === 'CLOSED' ? (
        <section className="surface">
          <p className="muted">Este incidente está encerrado e não pode mais ser alterado.</p>
          <Link to={`/incidentes/${data.id}`} className="button">
            Voltar para o incidente
          </Link>
        </section>
      ) : (
        <IncidentForm
          workspaceId={activeWorkspace?.id}
          defaultValues={incidentToForm(data)}
          submitLabel="Salvar alterações"
          pendingLabel="Salvando…"
          cancelTo={`/incidentes/${incidentId}`}
          onSubmit={async (body) => {
            await updateIncident.mutateAsync(body);
            navigate(`/incidentes/${incidentId}`, { replace: true, state: { updated: true } });
          }}
        />
      )}
    </main>
  );
}
