#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RepoReader, findRepoRoot } from './repo.js';
import { projectStructure } from './tools/project-structure.js';
import { architectureInfo } from './tools/architecture-info.js';
import { evaluateRubric, formatRubric } from './tools/rubric-status.js';
import { runNpmScript, type AllowedScript } from './tools/run-script.js';
import { formatSecurityCheck, securityCheck } from './tools/security-check.js';
import { dependencyInfo } from './tools/dependency-info.js';

/**
 * Aegis MCP. Deliberately has no shell tool and no arbitrary file reads:
 * every tool is a fixed, read-mostly operation over the allowlisted repo.
 */
const repo = new RepoReader(findRepoRoot());
const server = new McpServer({ name: 'aegis-mcp', version: '0.0.0' });

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

server.registerTool(
  'aegis_project_structure',
  { description: 'Directory tree of the allowlisted parts of the Bathke Aegis repository.' },
  async () => text(projectStructure(repo)),
);

server.registerTool(
  'aegis_architecture_info',
  { description: 'Current vs. planned components of Bathke Aegis.' },
  async () => text(architectureInfo()),
);

server.registerTool(
  'aegis_rubric_status',
  { description: 'Evidence-based status (TODO / IN_PROGRESS / PASS / BLOCKED) of each academic rubric requirement.' },
  async () => text(formatRubric(evaluateRubric(repo))),
);

const scriptTool = (script: AllowedScript) => async () => {
  const result = await runNpmScript(repo.root, script);
  return text(`exit code: ${result.exitCode ?? 'n/a'}\n\n${result.output}`);
};

server.registerTool(
  'aegis_run_typecheck',
  { description: 'Runs `npm run typecheck` at the repository root. Takes no arguments.' },
  scriptTool('typecheck'),
);

server.registerTool(
  'aegis_run_tests',
  { description: 'Runs `npm run test` at the repository root. Takes no arguments.' },
  scriptTool('test'),
);

server.registerTool(
  'aegis_security_check',
  { description: 'Scans allowlisted files for committed secret patterns and verifies .gitignore secret entries. Never prints matched values.' },
  async () => text(formatSecurityCheck(securityCheck(repo))),
);

server.registerTool(
  'aegis_dependency_info',
  { description: 'Lists declared dependencies of each workspace.' },
  async () => text(dependencyInfo(repo)),
);

await server.connect(new StdioServerTransport());
