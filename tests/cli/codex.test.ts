import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureCodex } from '../../src/cli/platforms/codex.js';

describe('configureCodex', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `entendi-codex-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates .codex/config.toml with MCP entry', () => {
    configureCodex(tempDir, { apiKey: 'test-key-123', apiUrl: 'https://api.entendi.dev' });

    const toml = readFileSync(join(tempDir, '.codex', 'config.toml'), 'utf-8');
    expect(toml).toContain('[mcp_servers.entendi]');
    expect(toml).toContain('https://api.entendi.dev/mcp');
    expect(toml).toContain('test-key-123');
  });

  it('appends to existing config.toml without duplicating', () => {
    mkdirSync(join(tempDir, '.codex'), { recursive: true });
    writeFileSync(join(tempDir, '.codex', 'config.toml'), 'model = "o3"\n');

    configureCodex(tempDir, { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });

    const toml = readFileSync(join(tempDir, '.codex', 'config.toml'), 'utf-8');
    expect(toml).toContain('model = "o3"');
    expect(toml).toContain('[mcp_servers.entendi]');
  });

  it('replaces existing entendi MCP section in config.toml', () => {
    mkdirSync(join(tempDir, '.codex'), { recursive: true });
    writeFileSync(
      join(tempDir, '.codex', 'config.toml'),
      'model = "o3"\n\n[mcp_servers.entendi]\nurl = "old"\napi_key = "old-key"\n',
    );

    configureCodex(tempDir, { apiKey: 'new-key', apiUrl: 'https://api.entendi.dev' });

    const toml = readFileSync(join(tempDir, '.codex', 'config.toml'), 'utf-8');
    expect(toml).toContain('new-key');
    expect(toml).not.toContain('old-key');
    // Should only have one entendi section
    const matches = toml.match(/\[mcp_servers\.entendi\]/g);
    expect(matches).toHaveLength(1);
  });

  it('copies skill file to .codex/skills/', () => {
    configureCodex(tempDir, { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });

    const skillPath = join(tempDir, '.codex', 'skills', 'entendi-concept-detection', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('entendi');
  });

  it('appends Entendi section to AGENTS.md', () => {
    configureCodex(tempDir, { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });

    const agentsMd = readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('## Entendi');
  });

  it('does not duplicate Entendi section in existing AGENTS.md', () => {
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agents\n\n## Entendi\nExisting config.\n');

    configureCodex(tempDir, { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });

    const agentsMd = readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8');
    const matches = agentsMd.match(/## Entendi/g);
    expect(matches).toHaveLength(1);
  });

  it('returns list of files written', () => {
    const result = configureCodex(tempDir, { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });
    expect(result.files).toContain('.codex/config.toml');
    expect(result.files).toContain('.codex/skills/entendi-concept-detection/SKILL.md');
    expect(result.files).toContain('AGENTS.md');
  });
});
