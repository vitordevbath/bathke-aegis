import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';

/** Same view for a missing event and an event of another workspace (the API answers 404 for both). */
export function EventNotFound() {
  return (
    <main className="content content--narrow">
      <EmptyState
        title="Evento não encontrado"
        description="Este evento não existe ou não pertence ao workspace atual."
        action={
          <Link to="/eventos" className="button">
            Voltar para eventos
          </Link>
        }
      />
    </main>
  );
}
