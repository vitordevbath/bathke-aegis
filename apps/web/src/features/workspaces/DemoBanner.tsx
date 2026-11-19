import { useWorkspace } from './WorkspaceContext';

/** Always visible inside AEGIS DEMO, so sample and simulated data are never taken for real telemetry (ADR-052). */
export function DemoBanner() {
  const { workspaces, activeWorkspace, selectWorkspace } = useWorkspace();
  if (activeWorkspace?.kind !== 'demo') return null;
  const personal = workspaces.find((workspace) => workspace.kind === 'personal');
  return (
    <div className="demo-banner" role="note">
      <p>
        <strong>Você está no AEGIS DEMO.</strong> Os dados são de exemplo, os hosts marcados como simulados geram telemetria sintética, e este workspace é
        somente leitura.
      </p>
      {personal && (
        <button type="button" className="button button--ghost" onClick={() => selectWorkspace(personal.id)}>
          Voltar ao meu workspace
        </button>
      )}
    </div>
  );
}
