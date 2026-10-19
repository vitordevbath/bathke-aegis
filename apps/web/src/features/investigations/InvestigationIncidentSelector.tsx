import { useId } from 'react';
import { Link } from 'react-router-dom';
import { MAX_PAGE_SIZE } from '@aegis/contracts';
import { SeverityBadge } from '../../components/SeverityBadge';
import { IncidentStatusBadge } from '../incidents/IncidentStatusBadge';
import { useIncidentList } from '../incidents/incidents-api';

interface InvestigationIncidentSelectorProps {
  readonly workspaceId: string | undefined;
  readonly value: readonly string[];
  readonly onChange: (incidentIds: string[]) => void;
  readonly error?: string | undefined;
}

/**
 * Multi-select of the current workspace's incidents (any status: a closed
 * incident can still be reviewed). At least one is required; the API checks
 * again that every id belongs to the workspace.
 */
export function InvestigationIncidentSelector({ workspaceId, value, onChange, error }: InvestigationIncidentSelectorProps) {
  const errorId = useId();
  const incidents = useIncidentList(workspaceId, { page: 1, pageSize: MAX_PAGE_SIZE });
  const toggle = (incidentId: string, checked: boolean) => onChange(checked ? [...value, incidentId] : value.filter((id) => id !== incidentId));

  if (incidents.isPending) return <p className="muted small">Carregando incidentes…</p>;
  if (incidents.isError) {
    return (
      <p className="notice notice--error" role="alert">
        Não foi possível carregar os incidentes.
      </p>
    );
  }
  const items = incidents.data.items;

  return (
    <fieldset className="targets" aria-describedby={error ? errorId : undefined}>
      <legend className="targets__legend">Selecione pelo menos um incidente</legend>
      {items.length === 0 ? (
        <p className="muted small">
          Nenhum incidente neste workspace. <Link to="/incidentes/novo">Registre um incidente</Link> para abrir uma investigação.
        </p>
      ) : (
        <ul className="targets__list">
          {items.map((incident) => (
            <li key={incident.id}>
              <label className="targets__option targets__option--rule">
                <input type="checkbox" checked={value.includes(incident.id)} onChange={(event) => toggle(incident.id, event.target.checked)} />
                <span className="targets__name">{incident.title}</span>
                <SeverityBadge severity={incident.severity} />
                <IncidentStatusBadge status={incident.status} />
              </label>
            </li>
          ))}
        </ul>
      )}
      {incidents.data.pagination.total > items.length && (
        <p className="muted small">
          Mostrando os {items.length} incidentes mais recentes de {incidents.data.pagination.total}.
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
