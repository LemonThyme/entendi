import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getTemplatesDir } from '../templates.js';

export interface CursorOptions {
  apiKey: string;
  apiUrl: string;
}

export interface ConfigResult {
  files: string[];
}

/**
 * Configure Entendi for Cursor IDE.
 * - Writes/merges .cursor/mcp.json with the entendi MCP server
 * - Copies entendi.mdc rules file to .cursor/rules/
 */
export function configureCursor(projectDir: string, opts: CursorOptions): ConfigResult {
  const files: string[] = [];

  // --- MCP config ---
  const mcpJsonPath = join(projectDir, '.cursor', 'mcp.json');
  let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };

  if (existsSync(mcpJsonPath)) {
    try {
      const existing = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
      if (existing.mcpServers) {
        mcpConfig = existing;
      }
    } catch {
      // Malformed JSON — start fresh but preserve the file structure
    }
  }

  mcpConfig.mcpServers.entendi = {
    url: `${opts.apiUrl}/mcp`,
    headers: { 'x-api-key': opts.apiKey },
  };

  mkdirSync(dirname(mcpJsonPath), { recursive: true });
  writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  files.push('.cursor/mcp.json');

  // --- Rules file ---
  const rulesDir = join(projectDir, '.cursor', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  const mdcDest = join(rulesDir, 'entendi.mdc');

  const templatesDir = getTemplatesDir();
  const mdcTemplatePath = join(templatesDir, 'cursor-rule.mdc');

  if (existsSync(mdcTemplatePath)) {
    writeFileSync(mdcDest, readFileSync(mdcTemplatePath, 'utf-8'));
  } else {
    // Fallback: generate minimal rules file
    writeFileSync(
      mdcDest,
      [
        '---',
        'description: entendi comprehension tracking',
        'globs: "**/*"',
        'alwaysApply: true',
        '---',
        '',
        '# Entendi Comprehension Tracking',
        '',
        'When you encounter technical concepts during development, use the entendi MCP tools',
        'to observe concepts and track understanding. Call `entendi_observe` when a concept is',
        'discussed, and respond to probes when they appear.',
        '',
      ].join('\n'),
    );
  }
  files.push('.cursor/rules/entendi.mdc');

  return { files };
}
