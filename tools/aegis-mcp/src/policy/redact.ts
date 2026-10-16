/** Patterns whose matches must never leave the MCP. Values are replaced, keys kept for context. */
const SECRET_ASSIGNMENT = /\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY)[A-Z0-9_]*)\s*([=:])\s*("[^"]*"|'[^']*'|\S+)/gi;
const CONNECTION_STRING_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^:/@\s]+):([^@/\s]+)@/gi;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g;

export function redactSecrets(text: string): string {
  return text
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED PRIVATE KEY]')
    .replace(CONNECTION_STRING_CREDENTIALS, '$1$2:[REDACTED]@')
    .replace(SECRET_ASSIGNMENT, '$1$2[REDACTED]')
    .replace(BEARER, '$1 [REDACTED]')
    .replace(GITHUB_TOKEN, '[REDACTED]');
}
