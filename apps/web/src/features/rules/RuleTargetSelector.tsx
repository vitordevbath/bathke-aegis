import { Link } from 'react-router-dom';
import { MAX_PAGE_SIZE } from '@aegis/contracts';
import { HostStatusBadge } from '../hosts/HostStatusBadge';
import { useHostList } from '../hosts/hosts-api';

interface RuleTargetSelectorProps {
  readonly workspaceId: string | undefined;
  readonly value: readonly string[];
  readonly onChange: (hostIds: string[]) => void;
  readonly error?: string | undefined;
}

/** Multi-select of the workspace's real hosts (state shown as reported — today "Não pareado"). */
export function RuleTargetSelector({ workspaceId, value, onChange, error }: RuleTargetSelectorProps) {
  const hosts = useHostList(workspaceId, { page: 1, pageSize: MAX_PAGE_SIZE });
  const toggle = (hostId: string, checked: boolean) =>
    onChange(checked ? [...value, hostId] : value.filter((id) => id !== hostId));

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
    <fieldset className="targets" aria-describedby={error ? 'targets-error' : undefined}>
      <legend className="targets__legend">Hosts alvo</legend>
      {items.length === 0 ? (
        <p className="muted small">
          Nenhum host neste workspace. <Link to="/hosts/novo">Cadastre um host</Link> ou escolha “Todos os hosts”.
        </p>
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
        <p className="muted small">Mostrando os primeiros {items.length} de {hosts.data.pagination.total} hosts.</p>
      )}
      {error && (
        <small id="targets-error" className="field__error" role="alert">
          {error}
        </small>
      )}
    </fieldset>
  );
}
