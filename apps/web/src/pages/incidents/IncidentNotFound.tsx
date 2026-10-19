import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';

/** Same view for a missing incident and an incident of another workspace (the API answers 404 for both). */
export function IncidentNotFound() {
  return (
    <main className="content content--narrow">
      <EmptyState
        title="Incidente não encontrado"
        description="Este incidente não existe ou não pertence ao workspace atual."
        action={
          <Link to="/incidentes" className="button">
            Voltar para incidentes
          </Link>
        }
      />
    </main>
  );
}
