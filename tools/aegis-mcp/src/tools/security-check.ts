import { ALLOWED_ROOT_DIRECTORIES, ALLOWED_ROOT_FILES } from '../policy/protected-paths.js';
import type { RepoReader } from '../repo.js';

export interface SecurityFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
}

/** Content rules. Findings report location and rule only — never the matched value. */
const CONTENT_RULES: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'private-key-block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { rule: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { rule: 'anthropic-or-openai-key', pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/ },
];

const REQUIRED_GITIGNORE_ENTRIES = ['.env', '.env.*', '!.env.example', 'secrets/', 'credentials/', '*.pem', '*.key'];
const TEXT_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|ya?ml|md|conf|toml|txt|sh|css|html|example)$/i;
const MAX_FILE_BYTES = 512 * 1024;

export function securityCheck(repo: RepoReader): { findings: SecurityFinding[]; gitignoreMissing: string[] } {
  const files = [
    ...ALLOWED_ROOT_FILES.filter((file) => repo.exists(file)),
    ...ALLOWED_ROOT_DIRECTORIES.flatMap((dir) => repo.listFiles(dir)),
  ].filter((file) => TEXT_EXTENSIONS.test(file) || file.endsWith('.gitignore'));

  const findings: SecurityFinding[] = [];
  for (const file of files) {
    const content = repo.readText(file);
    if (content.length > MAX_FILE_BYTES) continue;
    content.split('\n').forEach((text, index) => {
      for (const { rule, pattern } of CONTENT_RULES) {
        if (pattern.test(text)) findings.push({ file, line: index + 1, rule });
      }
    });
  }

  const gitignore = repo.exists('.gitignore') ? repo.readText('.gitignore').split(/\r?\n/) : [];
  const gitignoreMissing = REQUIRED_GITIGNORE_ENTRIES.filter((entry) => !gitignore.includes(entry));

  return { findings, gitignoreMissing };
}

export function formatSecurityCheck(result: ReturnType<typeof securityCheck>): string {
  const lines: string[] = [];
  lines.push(result.findings.length === 0 ? 'Secret patterns: none found' : `Secret patterns: ${result.findings.length} finding(s)`);
  for (const finding of result.findings) lines.push(`  ${finding.file}:${finding.line} [${finding.rule}]`);
  lines.push(
    result.gitignoreMissing.length === 0
      ? '.gitignore: all required secret entries present'
      : `.gitignore: missing ${result.gitignoreMissing.join(', ')}`,
  );
  return lines.join('\n');
}
