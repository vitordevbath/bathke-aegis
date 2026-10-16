import path from 'node:path';

/**
 * Secret guard for Aegis MCP. Every filesystem access performed by a tool
 * must pass through `resolveRepoPath`, which rejects protected paths, paths
 * outside the allowlist and paths escaping the repository root.
 */

const PROTECTED_DIRECTORIES = new Set(['secrets', 'credentials']);
const PROTECTED_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);
const ALLOWED_ENV_FILES = new Set(['.env.example']);

/** Top-level directories tools may read. Anything else is denied. */
export const ALLOWED_ROOT_DIRECTORIES: readonly string[] = [
  'apps',
  'packages',
  'tools',
  'native',
  'agents',
  'infra',
  'docs',
  'scripts',
  '.github',
];

/** Top-level files tools may read. */
export const ALLOWED_ROOT_FILES: readonly string[] = [
  'AGENTS.md',
  'README.md',
  'package.json',
  'tsconfig.base.json',
  'compose.yaml',
  '.gitignore',
  '.editorconfig',
  '.env.example',
];

/** Directories never traversed (noise, not secrets). */
export const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'target']);

function toSegments(relativePath: string): string[] {
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

/**
 * True when the path (relative to the repo root, either separator) points at
 * or inside a resource agents must never read. Matching is case-insensitive
 * because Windows and macOS filesystems are.
 */
export function isProtectedPath(relativePath: string): boolean {
  const segments = toSegments(relativePath).map((segment) => segment.toLowerCase());

  for (const segment of segments) {
    if (PROTECTED_DIRECTORIES.has(segment)) return true;
    if ((segment === '.env' || segment.startsWith('.env.')) && !ALLOWED_ENV_FILES.has(segment)) return true;
    if (PROTECTED_EXTENSIONS.has(path.extname(segment))) return true;
  }
  return false;
}

/** True when the path is inside the allowlisted area of the repository. */
export function isAllowedPath(relativePath: string): boolean {
  const segments = toSegments(relativePath);
  const [first] = segments;
  if (first === undefined) return false;
  if (segments.length === 1 && ALLOWED_ROOT_FILES.includes(first)) return true;
  return ALLOWED_ROOT_DIRECTORIES.includes(first);
}

export class PathAccessDeniedError extends Error {
  constructor(requested: string, reason: string) {
    super(`Access denied for "${requested}": ${reason}`);
    this.name = 'PathAccessDeniedError';
  }
}

/** Resolves a repo-relative path to an absolute one, or throws if access is not permitted. */
export function resolveRepoPath(repoRoot: string, requested: string): string {
  const absolute = path.resolve(repoRoot, requested);
  const relative = path.relative(repoRoot, absolute);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathAccessDeniedError(requested, 'outside repository');
  }
  if (isProtectedPath(relative)) throw new PathAccessDeniedError(requested, 'protected resource');
  if (!isAllowedPath(relative)) throw new PathAccessDeniedError(requested, 'not in allowlist');
  return absolute;
}
