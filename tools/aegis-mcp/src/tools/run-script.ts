import { spawn } from 'node:child_process';
import { redactSecrets } from '../policy/redact.js';

/** The only commands the MCP may execute. No arguments are accepted from callers. */
export const ALLOWED_SCRIPTS = {
  typecheck: ['run', 'typecheck'],
  test: ['run', 'test'],
} as const;

export type AllowedScript = keyof typeof ALLOWED_SCRIPTS;

const MAX_OUTPUT_CHARS = 20_000;
const TIMEOUT_MS = 5 * 60_000;

export interface ScriptResult {
  readonly exitCode: number | null;
  readonly output: string;
}

export function runNpmScript(repoRoot: string, script: AllowedScript): Promise<ScriptResult> {
  return new Promise((resolve) => {
    // npm is a .cmd shim on Windows, which requires a shell; arguments are constants, never caller input.
    const child = spawn('npm', [...ALLOWED_SCRIPTS[script]], {
      cwd: repoRoot,
      shell: process.platform === 'win32',
      env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
      timeout: TIMEOUT_MS,
    });
    let output = '';
    const append = (chunk: Buffer): void => {
      if (output.length < MAX_OUTPUT_CHARS) output += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => resolve({ exitCode: null, output: redactSecrets(error.message) }));
    child.on('close', (exitCode) => resolve({ exitCode, output: redactSecrets(output.slice(0, MAX_OUTPUT_CHARS)) }));
  });
}
