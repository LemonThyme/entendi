import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getTemplatesDir } from '../templates.js';

export interface CodexOptions {
  apiKey: string;
  apiUrl: string;
}

export interface ConfigResult {
  files: string[];
}

const ENTENDI_TOML_SECTION = '[mcp_servers.entendi]';

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

/**
 * Generate the TOML block for the entendi MCP server.
 */
function ententdiTomlBlock(opts: CodexOptions): string {
  return [
    ENTENDI_TOML_SECTION,
    `url = "${opts.apiUrl}/mcp"`,
    `api_key = "${opts.apiKey}"`,
  ].join('\n');
}

/**
 * Configure Entendi for Codex.
 * - Writes/updates .codex/config.toml with MCP entry
 * - Copies skill to .codex/skills/entendi-concept-detection/SKILL.md
 * - Appends Entendi section to AGENTS.md (avoids duplication)
 */
export function configureCodex(projectDir: string, opts: CodexOptions): ConfigResult {
  const files: string[] = [];

  // --- config.toml ---
  const configTomlPath = join(projectDir, '.codex', 'config.toml');
  mkdirSync(join(projectDir, '.codex'), { recursive: true });

  let toml = '';
  if (existsSync(configTomlPath)) {
    toml = readFileSync(configTomlPath, 'utf-8');
  }

  if (toml.includes(ENTENDI_TOML_SECTION)) {
    // Replace existing entendi section: from [mcp_servers.entendi] to next section or EOF
    toml = toml.replace(
      /\[mcp_servers\.entendi\][^\[]*(?=\[|$)/s,
      ententdiTomlBlock(opts) + '\n',
    );
  } else {
    // Append
    if (toml.length > 0 && !toml.endsWith('\n')) {
      toml += '\n';
    }
    if (toml.length > 0) {
      toml += '\n';
    }
    toml += ententdiTomlBlock(opts) + '\n';
  }

  writeFileSync(configTomlPath, toml);
  files.push('.codex/config.toml');

  // --- Skill files (copy entire skill/ directory tree) ---
  const skillDestDir = join(projectDir, '.codex', 'skills', 'entendi-concept-detection');
  const templatesDir = getTemplatesDir();
  const skillTemplateDir = join(templatesDir, 'skill');

  if (existsSync(skillTemplateDir)) {
    copyDirRecursive(skillTemplateDir, skillDestDir);
  } else {
    // Fallback: generate minimal skill
    mkdirSync(skillDestDir, { recursive: true });
    writeFileSync(
      join(skillDestDir, 'SKILL.md'),
      [
        '# Entendi Concept Detection',
        '',
        'When you encounter technical concepts during development, use the entendi MCP tools',
        'to observe concepts and track understanding. Call `entendi_observe` when a concept is',
        'discussed, and respond to probes when they appear.',
        '',
      ].join('\n'),
    );
  }
  files.push('.codex/skills/entendi-concept-detection/SKILL.md');

  // --- AGENTS.md ---
  const agentsMdPath = join(projectDir, 'AGENTS.md');
  let agentsMd = '';
  if (existsSync(agentsMdPath)) {
    agentsMd = readFileSync(agentsMdPath, 'utf-8');
  }

  if (!agentsMd.includes('## Entendi')) {
    const templatesAgentsPath = join(templatesDir, 'codex-agents-snippet.md');
    let section: string;

    if (existsSync(templatesAgentsPath)) {
      section = readFileSync(templatesAgentsPath, 'utf-8');
    } else {
      section = [
        '',
        '## Entendi',
        '',
        'Comprehension tracking is active via the entendi MCP server.',
        'Use `entendi_observe` to report concepts encountered during development.',
        '',
      ].join('\n');
    }

    if (agentsMd.length > 0 && !agentsMd.endsWith('\n')) {
      agentsMd += '\n';
    }
    agentsMd += section;
    writeFileSync(agentsMdPath, agentsMd);
  }
  files.push('AGENTS.md');

  return { files };
}
