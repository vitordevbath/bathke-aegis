import { ALLOWED_ROOT_DIRECTORIES, ALLOWED_ROOT_FILES } from '../policy/protected-paths.js';
import type { RepoReader } from '../repo.js';

/** Directory tree (depth-limited) of the allowlisted parts of the repository. */
export function projectStructure(repo: RepoReader, maxDepth = 3): string {
  const lines: string[] = ['bathke-aegis/'];
  for (const file of ALLOWED_ROOT_FILES) if (repo.exists(file)) lines.push(`  ${file}`);

  for (const dir of ALLOWED_ROOT_DIRECTORIES) {
    if (!repo.exists(dir)) continue;
    const dirs = new Set<string>();
    for (const file of repo.listFiles(dir)) {
      const parts = file.split('/');
      for (let depth = 1; depth <= Math.min(parts.length - 1, maxDepth); depth++) {
        dirs.add(parts.slice(0, depth).join('/'));
      }
    }
    for (const entry of [...dirs].sort()) {
      const depth = entry.split('/').length;
      lines.push(`${'  '.repeat(depth)}${entry.split('/').at(-1) ?? entry}/`);
    }
  }
  return lines.join('\n');
}
