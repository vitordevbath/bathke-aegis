import { useWorkspace } from './WorkspaceContext';
import { WORKSPACE_KIND_LABELS } from '../auth/labels';

/** Discreet label with one workspace; a selector once there are several (e.g. a future demo workspace). */
export function WorkspaceSelector() {
  const { workspaces, activeWorkspace, selectWorkspace } = useWorkspace();
  if (!activeWorkspace) return null;

  if (workspaces.length === 1) {
    return (
      <span className="workspace-selector" title={`Workspace ${WORKSPACE_KIND_LABELS[activeWorkspace.kind].toLowerCase()}`}>
        <span className="workspace-selector__label">Workspace</span>
        <span className="workspace-selector__name">{activeWorkspace.name}</span>
      </span>
    );
  }

  return (
    <label className="workspace-selector">
      <span className="workspace-selector__label">Workspace</span>
      <select
        className="workspace-selector__select"
        value={activeWorkspace.id}
        onChange={(event) => selectWorkspace(event.target.value)}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </label>
  );
}
