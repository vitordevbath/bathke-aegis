import { useId, type ReactNode } from 'react';
import { MAX_PAGE_SIZE } from '@aegis/contracts';
import { HostStatusBadge } from './HostStatusBadge';
import { useHostList } from './hosts-api';

interface HostPickerProps {
  readonly workspaceId: string | undefined;
  readonly legend: string;
  readonly value: readonly string[];
  readonly onChange: (hostIds: string[]) => void;
  /** Shown when the workspace has no hosts. */
  readonly emptyMessage: ReactNode;
  readonly error?: string | undefined;
}

/**
 * Multi-select of the workspace's real hosts, with the state each one reports
 * (today "Não pareado"). Used for rule targets and incident hosts.
 */
export function HostPicker({ workspaceId, legend, value, onChange, emptyMessage, error }: HostPickerProps) {
  const errorId = useId();
  const hosts = useHostList(workspaceId, { page: 1, pageSize: MAX_PAGE_SIZE });
  const toggle = (hostId: string, checked: boolean) => onChange(checked ? [...value, hostId] : value.filter((id) => id !== hostId));

  if (hosts.isPending) return <p className="muted small">Carregando hosts…</p>;
  if (hosts.isError) {
    return (
      <p className="notice notice--error" role="alert">
        Não foi possível carregar os hosts.
      </p>
    );
  }
  const items = hosts.data.items;

  return (
    <fieldset className="targets" aria-describedby={error ? errorId : undefined}>
      <legend className="targets__legend">{legend}</legend>
      {items.length === 0 ? (
        <p className="muted small">{emptyMessage}</p>
      ) : (
        <ul className="targets__list">
          {items.map((host) => (
            <li key={host.id}>
              <label className="targets__option">
                <input type="checkbox" checked={value.includes(host.id)} onChange={(event) => toggle(host.id, event.target.checked)} />
                <span className="targets__name">{host.displayName}</span>
                <HostStatusBadge state={host.connectionState} />
              </label>
            </li>
          ))}
        </ul>
      )}
      {hosts.data.pagination.total > items.length && (
        <p className="muted small">
          Mostrando os primeiros {items.length} de {hosts.data.pagination.total} hosts.
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
