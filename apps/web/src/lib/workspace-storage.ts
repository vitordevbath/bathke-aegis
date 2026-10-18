/**
 * Remembers the last selected workspace. A preference only — never an
 * authorization: the API checks membership on every request.
 */
export const ACTIVE_WORKSPACE_KEY = 'aegis.workspace.active';

export const workspaceStorage = {
  get(): string | null {
    try {
      return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    } catch {
      return null;
    }
  },

  set(workspaceId: string): void {
    try {
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
    } catch {
      // Preference is simply not remembered.
    }
  },
};
