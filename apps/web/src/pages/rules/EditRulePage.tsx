import { useNavigate, useParams } from 'react-router-dom';
import { DetectionRuleForm } from '../../features/rules/DetectionRuleForm';
import { ruleToForm } from '../../features/rules/rule-form-model';
import { useRule, useUpdateRule } from '../../features/rules/rules-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { RuleNotFound } from './RuleNotFound';

/** Separate edit screen (rubric), reusing the same form as creation. */
export function EditRulePage() {
  const { ruleId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const rule = useRule(activeWorkspace?.id, ruleId);
  const updateRule = useUpdateRule(activeWorkspace?.id ?? '', ruleId);

  if (rule.error instanceof ApiError && rule.error.status === 404) return <RuleNotFound />;
  if (rule.isError) {
    return (
      <main className="content content--medium">
        <p className="notice notice--error" role="alert">
          Não foi possível carregar a regra agora. Tente novamente.
        </p>
      </main>
    );
  }
  if (!rule.data) return <main className="content content--medium muted">Carregando regra…</main>;

  return (
    <main className="content content--medium">
      <header className="page-header">
        <p className="eyebrow">Editar regra</p>
        <h1 className="title">{rule.data.name}</h1>
      </header>
      <DetectionRuleForm
        workspaceId={activeWorkspace?.id}
        defaultValues={ruleToForm(rule.data)}
        submitLabel="Salvar alterações"
        pendingLabel="Salvando…"
        cancelTo={`/regras/${ruleId}`}
        onSubmit={async (body) => {
          await updateRule.mutateAsync(body);
          navigate(`/regras/${ruleId}`, { replace: true, state: { updated: true } });
        }}
      />
    </main>
  );
}
