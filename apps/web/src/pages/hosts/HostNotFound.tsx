import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';

/** Same view for a missing host and a host of another workspace: the API answers 404 for both. */
export function HostNotFound() {
  return (
    <main className="content content--narrow">
      <EmptyState
        title="Host não encontrado"
        description="Este host não existe ou não pertence ao workspace atual."
        action={
          <Link to="/hosts" className="button">
            Voltar para hosts
          </Link>
        }
      />
    </main>
  );
}
