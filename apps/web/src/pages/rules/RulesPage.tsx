import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DETECTION_EVENT_CATEGORIES, DETECTION_SEVERITIES } from '@aegis/domain';
import { EmptyState } from '../../components/EmptyState';
import { Pagination } from '../../components/Pagination';
import { EngineNotice } from '../../features/rules/EngineNotice';
import { RuleStatusBadge } from '../../features/rules/RuleStatusBadge';
import { SeverityBadge } from '../../features/rules/SeverityBadge';
import { CATEGORY_LABELS, SCOPE_LABELS, SEVERITY_LABELS } from '../../features/rules/rule-labels';
import { useRuleList } from '../../features/rules/rules-api';
import { useWorkspace } from '../../features/workspaces/WorkspaceContext';
import { RULES_PAGE_SIZE, readRuleListParams, writeRuleListParams, type RuleListUrlState } from './rule-route-params';

export function RulesPage() {
  const { activeWorkspace } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readRuleListParams(searchParams);
  const [draft, setDraft] = useState(state.q);
  const list = useRuleList(activeWorkspace?.id, {
    page: state.page,
    pageSize: RULES_PAGE_SIZE,
    q: state.q || undefined,
    severity: state.severity,
    eventCategory: state.eventCategory,
    enabled: state.enabled,
  });

  const update = (changes: Partial<RuleListUrlState>) =>
    setSearchParams(writeRuleListParams({ ...state, page: 1, ...changes }));
  const filtered = Boolean(state.q || state.severity || state.eventCategory || state.enabled !== undefined);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    update({ q: draft.trim() });
  };

  const total = list.data?.pagination.total ?? 0;
  const items = list.data?.items ?? [];

  return (
    <main className="content">
      <header className="page-header page-header--split">
        <div>
          <p className="eyebrow">{activeWorkspace?.name}</p>
          <h1 className="title">Regras de detecção</h1>
          {list.data && (
            <p className="muted small" aria-live="polite">
              {total} {total === 1 ? 'regra' : 'regras'}
              {filtered ? ' encontradas' : ' configuradas'}
            </p>
          )}
        </div>
        <Link to="/regras/nova" className="button button--primary">
          Nova regra
        </Link>
      </header>

      <EngineNotice />

      <div className="toolbar">
        <form className="search" role="search" onSubmit={submitSearch}>
          <label className="visually-hidden" htmlFor="rule-search">
            Buscar regras
          </label>
          <input
            id="rule-search"
            type="search"
            placeholder="Buscar por nome ou descrição"
            value={draft}
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="button">
            Buscar
          </button>
        </form>
        <div className="filters">
          <label className="filter">
            <span className="visually-hidden">Severidade</span>
            <select value={state.severity ?? ''} onChange={(event) => update({ severity: (event.target.value || undefined) as RuleListUrlState['severity'] })}>
              <option value="">Todas as severidades</option>
              {DETECTION_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {SEVERITY_LABELS[severity]}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span className="visually-hidden">Categoria</span>
            <select
              value={state.eventCategory ?? ''}
              onChange={(event) => update({ eventCategory: (event.target.value || undefined) as RuleListUrlState['eventCategory'] })}
            >
              <option value="">Todas as categorias</option>
              {DETECTION_EVENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span className="visually-hidden">Status</span>
            <select
              value={state.enabled === undefined ? '' : String(state.enabled)}
              onChange={(event) => update({ enabled: event.target.value === '' ? undefined : event.target.value === 'true' })}
            >
              <option value="">Habilitadas e desabilitadas</option>
              <option value="true">Habilitadas</option>
              <option value="false">Desabilitadas</option>
            </select>
          </label>
          {filtered && (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setDraft('');
                setSearchParams(new URLSearchParams());
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {list.isPending && <p className="muted">Carregando regras…</p>}
      {list.isError && (
        <p className="notice notice--error" role="alert">
          Não foi possível carregar as regras agora. Tente novamente.
        </p>
      )}

      {list.data && total === 0 && !filtered && (
        <EmptyState
          title="Nenhuma regra de detecção configurada."
          description="Crie regras para preparar o Aegis para analisar eventos quando o motor de detecção estiver ativo."
          action={
            <Link to="/regras/nova" className="button button--primary">
              Nova regra
            </Link>
          }
        />
      )}
      {list.data && total === 0 && filtered && <EmptyState title="Nenhuma regra encontrada." description="Ajuste a busca ou os filtros." />}
      {list.data && total > 0 && items.length === 0 && (
        <EmptyState
          title="Esta página não existe."
          description="A lista tem menos páginas do que o endereço indica."
          action={
            <button type="button" className="button" onClick={() => update({})}>
              Ir para a primeira página
            </button>
          }
        />
      )}

      {items.length > 0 && (
        <ul className="rule-list" aria-label="Regras" aria-busy={list.isFetching}>
          {items.map((rule) => (
            <li key={rule.id}>
              <Link to={`/regras/${rule.id}`} className="rule-row">
                <span className="rule-row__main">
                  <span className="rule-row__name">{rule.name}</span>
                  <span className="rule-row__meta">
                    {CATEGORY_LABELS[rule.eventCategory]} · {rule.conditionCount} {rule.conditionCount === 1 ? 'condição' : 'condições'} ·{' '}
                    {rule.scope === 'ALL_HOSTS' ? SCOPE_LABELS.ALL_HOSTS : `${rule.targetCount} ${rule.targetCount === 1 ? 'host' : 'hosts'}`}
                  </span>
                </span>
                <SeverityBadge severity={rule.severity} />
                <RuleStatusBadge enabled={rule.enabled} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {list.data && (
        <Pagination
          page={state.page}
          totalPages={list.data.pagination.totalPages}
          disabled={list.isFetching}
          onPageChange={(page) => setSearchParams(writeRuleListParams({ ...state, page }))}
        />
      )}
    </main>
  );
}
