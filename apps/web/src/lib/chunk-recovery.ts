/**
 * Recovery for screens loaded on demand. Every build renames its files, so a tab opened before a
 * deploy asks for files that no longer exist. The first time that happens the page reloads itself,
 * picking up the new index.html; if it fails again soon after, the error reaches the route's error
 * screen instead of reloading in a loop.
 */
export const CHUNK_RELOAD_KEY = 'aegis:chunk-reload-at';
export const CHUNK_RELOAD_WINDOW_MS = 10_000;

function recentlyReloaded(now: number): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY));
    return Number.isFinite(last) && now - last < CHUNK_RELOAD_WINDOW_MS;
  } catch {
    // Storage blocked: never reload automatically, so a broken build cannot loop.
    return true;
  }
}

export async function loadWithReload<M>(load: () => Promise<M>, reload: () => void = () => window.location.reload()): Promise<M> {
  try {
    return await load();
  } catch (error) {
    const now = Date.now();
    if (recentlyReloaded(now)) throw error;
    try {
      window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
    } catch {
      throw error;
    }
    reload();
    // The page is going away; keep the router waiting instead of flashing an error.
    return new Promise<M>(() => {});
  }
}
