import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';

/** Same view for a missing investigation and one of another workspace (the API answers 404 for both). */
export function InvestigationNotFound() {
  return (
    <main className="content content--narrow">
      <EmptyState
        title="Investigação não encontrada"
        description="Esta investigação não existe ou não pertence ao workspace atual."
        action={
          <Link to="/investigacoes" className="button">
            Voltar para investigações
          </Link>
        }
      />
    </main>
  );
}
