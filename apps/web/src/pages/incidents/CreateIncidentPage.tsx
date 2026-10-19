import { useNavigate } from 'react-router-dom';
import { CorrelationNotice } from '../../features/incidents/CorrelationNotice';
import { IncidentForm } from '../../features/incidents/IncidentForm';
import { useCreateIncident } from '../../features/incidents/incidents-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';

export function CreateIncidentPage() {
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const createIncident = useCreateIncident(activeWorkspace?.id ?? '');

  return (
    <main className="content content--medium">
      <header className="page-header">
        <p className="eyebrow">{activeWorkspace?.name}</p>
        <h1 className="title">Novo incidente</h1>
      </header>
      <CorrelationNotice />
      <IncidentForm
        workspaceId={activeWorkspace?.id}
        footnote={<p className="muted small">O incidente começa com status “Aberto” e origem “Manual”.</p>}
        submitLabel="Registrar incidente"
        pendingLabel="Registrando…"
        cancelTo="/incidentes"
        onSubmit={async (body) => {
          const incident = await createIncident.mutateAsync(body);
          navigate(`/incidentes/${incident.id}`, { replace: true, state: { created: true } });
        }}
      />
    </main>
  );
}
