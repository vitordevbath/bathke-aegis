import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ConfirmAction } from '../../components/ConfirmAction';
import { HostStatusBadge } from '../../features/hosts/HostStatusBadge';
import { formatDateTime } from '../../features/hosts/host-format';
import { EngineNotice } from '../../features/rules/EngineNotice';
import { RuleStatusBadge } from '../../features/rules/RuleStatusBadge';
import { SeverityBadge } from '../../features/rules/SeverityBadge';
import { CATEGORY_LABELS, MATCH_CONNECTOR, MATCH_LABELS, SCOPE_LABELS, describeCondition } from '../../features/rules/rule-labels';
import { toRequest, useDeleteRule, useRule, useUpdateRule } from '../../features/rules/rules-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { ApiError } from '../../lib/api-client';
import { RuleNotFound } from './RuleNotFound';

export function RuleDetailPage() {
  const { ruleId = '' } = useParams();
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as { created?: boolean; updated?: boolean };
  const rule = useRule(activeWorkspace?.id, ruleId);
  const updateRule = useUpdateRule(activeWorkspace?.id ?? '', ruleId);
  const deleteRule = useDeleteRule(activeWorkspace?.id ?? '', ruleId);

  if (rule.error instanceof ApiError && rule.error.status === 404) return <RuleNotFound />;
  if (rule.isError) {
    return (
      <main className="content content--narrow">
        <p className="notice notice--error" role="alert">
          Não foi possível carregar a regra agora. Tente novamente.
        </p>
      </main>
    );
  }
  if (!rule.data) return <main className="content content--narrow muted">Carregando regra…</main>;

  const data = rule.data;
  const toggle = () => updateRule.mutate(toRequest(data, { enabled: !data.enabled }));

  return (
    <main className="content content--narrow">
      <nav aria-label="Trilha" className="breadcrumb">
        <Link to="/regras">Regras</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{data.name}</span>
      </nav>

      <header className="page-header page-header--split">
        <div>
          <h1 className="title">{data.name}</h1>
          {data.description ? <p className="muted">{data.description}</p> : <p className="muted small">Sem descrição.</p>}
        </div>
        <div className="badges">
          <SeverityBadge severity={data.severity} />
          <RuleStatusBadge enabled={data.enabled} />
        </div>
      </header>

      {(state.created || state.updated) && (
        <p className="notice notice--success" role="status">
          {state.created ? 'Regra criada.' : 'Regra atualizada.'}
        </p>
      )}
      <EngineNotice />

      <section className="surface" aria-labelledby="conditions-title">
        <h2 id="conditions-title" className="section-title">
          Condições · {MATCH_LABELS[data.definition.match]}
        </h2>
        <ol className="condition-summary">
          {data.definition.conditions.map((condition, index) => (
            <li key={`${condition.field}-${index}`}>
              <span className="condition__connector" aria-hidden="true">
                {index === 0 ? 'SE' : MATCH_CONNECTOR[data.definition.match]}
              </span>
              {describeCondition(condition)}
            </li>
          ))}
        </ol>
        <details className="definition-preview">
          <summary>Visualizar definição</summary>
          <pre>{JSON.stringify(data.definition, null, 2)}</pre>
        </details>
      </section>

      <section className="surface" aria-labelledby="scope-title">
        <h2 id="scope-title" className="section-title">
          Escopo · {SCOPE_LABELS[data.scope]}
        </h2>
        {data.scope === 'ALL_HOSTS' ? (
          <p className="muted small">Vale para todos os hosts deste workspace.</p>
        ) : (
          <ul className="target-summary">
            {data.targets.map((target) => (
              <li key={target.hostId}>
                <Link to={`/hosts/${target.hostId}`}>{target.displayName}</Link>
                <HostStatusBadge state={target.connectionState} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface" aria-labelledby="meta-title">
        <h2 id="meta-title" className="section-title">
          Cadastro
        </h2>
        <dl className="facts">
          <div>
            <dt>Categoria</dt>
            <dd>{CATEGORY_LABELS[data.eventCategory]}</dd>
          </div>
          <div>
            <dt>Versão da definição</dt>
            <dd>v{data.definition.version}</dd>
          </div>
          <div>
            <dt>Criada em</dt>
            <dd>{formatDateTime(data.createdAt)}</dd>
          </div>
          <div>
            <dt>Atualizada em</dt>
            <dd>{formatDateTime(data.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <div className="detail-actions">
        <Link to={`/regras/${data.id}/editar`} className="button">
          Editar
        </Link>
        <button type="button" className="button" disabled={updateRule.isPending} onClick={toggle}>
          {data.enabled ? 'Desabilitar' : 'Habilitar'}
        </button>
        <ConfirmAction
          triggerLabel="Excluir"
          title="Excluir esta regra?"
          description="A regra e a lista de hosts alvo serão removidas. Os hosts continuam cadastrados."
          confirmLabel="Excluir regra"
          pendingLabel="Excluindo…"
          onConfirm={async () => {
            await deleteRule.mutateAsync();
            navigate('/regras', { replace: true });
          }}
        />
      </div>
      {(updateRule.isError || deleteRule.isError) && (
        <p className="notice notice--error" role="alert">
          {deleteRule.isError ? 'Não foi possível excluir a regra agora. Tente novamente.' : 'Não foi possível alterar o status agora. Tente novamente.'}
        </p>
      )}
    </main>
  );
}
