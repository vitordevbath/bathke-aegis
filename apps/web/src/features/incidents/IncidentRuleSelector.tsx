import { useId } from 'react';
import { Link } from 'react-router-dom';
import { MAX_PAGE_SIZE } from '@aegis/contracts';
import { SeverityBadge } from '../../components/SeverityBadge';
import { RuleStatusBadge } from '../rules/RuleStatusBadge';
import { useRuleList } from '../rules/rules-api';

interface IncidentRuleSelectorProps {
  readonly workspaceId: string | undefined;
  readonly value: readonly string[];
  readonly onChange: (ruleIds: string[]) => void;
  readonly error?: string | undefined;
}

/**
 * Optional, manual link to the workspace's detection rules. Disabled rules can
 * be related too (the incident may predate the change). Nothing here means a
 * rule "fired": rules are not executed yet.
 */
export function IncidentRuleSelector({ workspaceId, value, onChange, error }: IncidentRuleSelectorProps) {
  const errorId = useId();
  const rules = useRuleList(workspaceId, { page: 1, pageSize: MAX_PAGE_SIZE });
  const toggle = (ruleId: string, checked: boolean) => onChange(checked ? [...value, ruleId] : value.filter((id) => id !== ruleId));

  if (rules.isPending) return <p className="muted small">Carregando regras…</p>;
  if (rules.isError) {
    return (
      <p className="notice notice--error" role="alert">
        Não foi possível carregar as regras.
      </p>
    );
  }
  const items = rules.data.items;

  return (
    <fieldset className="targets" aria-describedby={error ? errorId : undefined}>
      <legend className="targets__legend">Regras relacionadas (opcional)</legend>
      {items.length === 0 ? (
        <p className="muted small">
          Nenhuma regra configurada neste workspace. Relacionar regras é opcional — <Link to="/regras/nova">crie uma regra</Link> se quiser.
        </p>
      ) : (
        <ul className="targets__list">
          {items.map((rule) => (
            <li key={rule.id}>
              <label className="targets__option targets__option--rule">
                <input type="checkbox" checked={value.includes(rule.id)} onChange={(event) => toggle(rule.id, event.target.checked)} />
                <span className="targets__name">{rule.name}</span>
                <SeverityBadge severity={rule.severity} />
                <RuleStatusBadge enabled={rule.enabled} />
              </label>
            </li>
          ))}
        </ul>
      )}
      {rules.data.pagination.total > items.length && (
        <p className="muted small">
          Mostrando as primeiras {items.length} de {rules.data.pagination.total} regras.
        </p>
      )}
      {error && (
        <small id={errorId} className="field__error" role="alert">
          {error}
        </small>
      )}
    </fieldset>
  );
}
