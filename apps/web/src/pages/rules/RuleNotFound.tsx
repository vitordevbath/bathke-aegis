import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';

/** Same view for a missing rule and a rule of another workspace (the API answers 404 for both). */
export function RuleNotFound() {
  return (
    <main className="content content--narrow">
      <EmptyState
        title="Regra não encontrada"
        description="Esta regra não existe ou não pertence ao workspace atual."
        action={
          <Link to="/regras" className="button">
            Voltar para regras
          </Link>
        }
      />
    </main>
  );
}
