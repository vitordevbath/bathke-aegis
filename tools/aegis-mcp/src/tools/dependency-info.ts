import type { RepoReader } from '../repo.js';

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const MANIFESTS = [
  'package.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'packages/contracts/package.json',
  'packages/domain/package.json',
  'tools/aegis-mcp/package.json',
];

export function dependencyInfo(repo: RepoReader): string {
  const sections: string[] = [];
  for (const manifest of MANIFESTS) {
    if (!repo.exists(manifest)) continue;
    const pkg = repo.readJson<PackageJson>(manifest);
    const list = (deps: Record<string, string> | undefined): string =>
      Object.entries(deps ?? {})
        .map(([name, version]) => `${name}@${version}`)
        .join(', ') || '-';
    sections.push(`${pkg.name ?? manifest} (${manifest})\n  dependencies: ${list(pkg.dependencies)}\n  devDependencies: ${list(pkg.devDependencies)}`);
  }
  return sections.join('\n\n');
}
