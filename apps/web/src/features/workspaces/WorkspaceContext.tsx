import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { WorkspaceSummary } from '@aegis/contracts';
import { useAuth } from '../auth/AuthContext';
import { workspaceStorage } from '../../lib/workspace-storage';

interface WorkspaceContextValue {
  readonly workspaces: readonly WorkspaceSummary[];
  /** Null only if the account has no workspace at all (registration always creates one). */
  readonly activeWorkspace: WorkspaceSummary | null;
  selectWorkspace(workspaceId: string): void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Picks the active workspace among the user's memberships. A remembered id
 * that no longer belongs to the user is ignored in favor of the first valid one.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { workspaces } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(() => workspaceStorage.get());

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0] ?? null,
    [workspaces, selectedId],
  );

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      if (!workspaces.some((workspace) => workspace.id === workspaceId)) return;
      workspaceStorage.set(workspaceId);
      setSelectedId(workspaceId);
    },
    [workspaces],
  );

  const value = useMemo(() => ({ workspaces, activeWorkspace, selectWorkspace }), [workspaces, activeWorkspace, selectWorkspace]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return context;
}
