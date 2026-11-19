import { Link, Outlet } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { useCanManage, useWorkspace } from './WorkspaceContext';

/**
 * Guards create and edit screens: a viewer who opens one by URL gets an explanation instead of a form
 * whose submit would be refused (403). The API remains the authority.
 */
export function ManagerOnly() {
  const canManage = useCanManage();
  const { activeWorkspace } = useWorkspace();
  if (canManage) return <Outlet />;
  return (
    <main className="content content--narrow">
      <EmptyState
        title="Este workspace é somente leitura."
        description={`Seu papel em ${activeWorkspace?.name ?? 'este workspace'} permite ver os dados, não criar nem alterar.`}
        action={
          <Link to="/dashboard" className="button">
            Voltar ao painel
          </Link>
        }
      />
    </main>
  );
}
