import { Link } from 'react-router-dom';
import { HostPicker } from '../hosts/HostPicker';

interface RuleTargetSelectorProps {
  readonly workspaceId: string | undefined;
  readonly value: readonly string[];
  readonly onChange: (hostIds: string[]) => void;
  readonly error?: string | undefined;
}

/** Target hosts of a SELECTED_HOSTS rule. */
export function RuleTargetSelector(props: RuleTargetSelectorProps) {
  return (
    <HostPicker
      {...props}
      legend="Hosts alvo"
      emptyMessage={
        <>
          Nenhum host neste workspace. <Link to="/hosts/novo">Cadastre um host</Link> ou escolha “Todos os hosts”.
        </>
      }
    />
  );
}
