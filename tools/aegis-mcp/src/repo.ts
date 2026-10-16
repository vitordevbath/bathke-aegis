import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKIPPED_DIRECTORIES, isProtectedPath, resolveRepoPath } from './policy/protected-paths.js';

const ROOT_PACKAGE_NAME = 'bathke-aegis';

/** Walks up from this module until it finds the root package.json of Bathke Aegis. */
export function findRepoRoot(start: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let current = start;
  for (;;) {
    const candidate = path.join(current, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: unknown };
      if (pkg.name === ROOT_PACKAGE_NAME) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Bathke Aegis repository root not found');
    current = parent;
  }
}

/** Read access for tools. Every path goes through the secret guard. */
export class RepoReader {
  constructor(public readonly root: string) {}

  exists(relativePath: string): boolean {
    try {
      return existsSync(resolveRepoPath(this.root, relativePath));
    } catch {
      return false;
    }
  }

  readText(relativePath: string): string {
    return readFileSync(resolveRepoPath(this.root, relativePath), 'utf8');
  }

  readJson<T>(relativePath: string): T {
    return JSON.parse(this.readText(relativePath)) as T;
  }

  /** Lists repo-relative file paths under `relativeDir`, skipping protected and build directories. */
  listFiles(relativeDir: string, maxDepth = 6): string[] {
    const results: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > maxDepth) return;
      const absolute = resolveRepoPath(this.root, dir);
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        const child = path.posix.join(dir.replace(/\\/g, '/'), entry.name);
        if (isProtectedPath(child)) continue;
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(child, depth + 1);
        } else if (entry.isFile()) {
          results.push(child);
        }
      }
    };
    if (this.exists(relativeDir) && statSync(resolveRepoPath(this.root, relativeDir)).isDirectory()) {
      walk(relativeDir, 0);
    }
    return results.sort();
  }
}
