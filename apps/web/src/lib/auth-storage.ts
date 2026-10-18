/**
 * The only module that touches the stored access token.
 *
 * The token lives in localStorage because the academic rubric requires it.
 * Trade-off (docs/DECISIONS.md, ADR-017): any script running on the page can
 * read it, so XSS prevention (React escaping, strict CSP in Nginx, no
 * dangerouslySetInnerHTML) is mandatory.
 */
export const AUTH_TOKEN_KEY = 'aegis.auth.token';

export const authStorage = {
  getToken(): string | null {
    try {
      return window.localStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  },

  setToken(token: string): void {
    try {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    } catch {
      // Storage unavailable (private mode, quota): the session lasts until reload.
    }
  },

  clearToken(): void {
    try {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {
      // Nothing to clear.
    }
  },
};
