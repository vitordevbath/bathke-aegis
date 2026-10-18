import { useNavigate } from 'react-router-dom';
import { DetectionRuleForm } from '../../features/rules/DetectionRuleForm';
import { useCreateRule } from '../../features/rules/rules-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';

export function CreateRulePage() {
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const createRule = useCreateRule(activeWorkspace?.id ?? '');

  return (
    <main className="content content--medium">
      <header className="page-header">
        <p className="eyebrow">{activeWorkspace?.name}</p>
        <h1 className="title">Nova regra de detecção</h1>
      </header>
      <DetectionRuleForm
        workspaceId={activeWorkspace?.id}
        submitLabel="Criar regra"
        pendingLabel="Criando…"
        cancelTo="/regras"
        onSubmit={async (body) => {
          const rule = await createRule.mutateAsync(body);
          navigate(`/regras/${rule.id}`, { replace: true, state: { created: true } });
        }}
      />
    </main>
  );
}
