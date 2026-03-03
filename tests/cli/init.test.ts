import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureCodex } from '../../src/cli/platforms/codex.js';
import { configureCursor } from '../../src/cli/platforms/cursor.js';
import { detectPlatforms } from '../../src/cli/platforms/detect.js';

describe('CLI integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `entendi-init-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects Cursor and configures it end-to-end', () => {
    // Setup: create .cursor/ directory
    mkdirSync(join(tempDir, '.cursor'));

    // Detect
    const platforms = detectPlatforms(tempDir);
    expect(platforms.map(p => p.id)).toContain('cursor');

    // Configure
    const result = configureCursor(tempDir, {
      apiKey: 'ek_test_integration',
      apiUrl: 'https://api.entendi.dev',
    });

    // Verify mcp.json
    const mcpJson = JSON.parse(readFileSync(join(tempDir, '.cursor', 'mcp.json'), 'utf-8'));
    expect(mcpJson.mcpServers.entendi.url).toBe('https://api.entendi.dev/mcp');
    expect(mcpJson.mcpServers.entendi.headers['x-api-key']).toBe('ek_test_integration');

    // Verify rules file
    expect(existsSync(join(tempDir, '.cursor', 'rules', 'entendi.mdc'))).toBe(true);

    // Verify result
    expect(result.files.length).toBeGreaterThanOrEqual(2);
  });

  it('detects Codex and configures it end-to-end', () => {
    mkdirSync(join(tempDir, '.codex'));

    const platforms = detectPlatforms(tempDir);
    expect(platforms.map(p => p.id)).toContain('codex');

    const result = configureCodex(tempDir, {
      apiKey: 'ek_test_integration',
      apiUrl: 'https://api.entendi.dev',
    });

    // Verify config.toml
    const toml = readFileSync(join(tempDir, '.codex', 'config.toml'), 'utf-8');
    expect(toml).toContain('[mcp_servers.entendi]');

    // Verify skill
    expect(existsSync(join(tempDir, '.codex', 'skills', 'entendi-concept-detection', 'SKILL.md'))).toBe(true);

    // Verify AGENTS.md
    expect(existsSync(join(tempDir, 'AGENTS.md'))).toBe(true);
    expect(readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8')).toContain('## Entendi');

    expect(result.files.length).toBeGreaterThanOrEqual(3);
  });

  it('detects and configures multiple platforms', () => {
    mkdirSync(join(tempDir, '.cursor'));
    mkdirSync(join(tempDir, '.codex'));

    const platforms = detectPlatforms(tempDir);
    expect(platforms).toHaveLength(2);

    const cursorResult = configureCursor(tempDir, { apiKey: 'key', apiUrl: 'https://api.entendi.dev' });
    const codexResult = configureCodex(tempDir, { apiKey: 'key', apiUrl: 'https://api.entendi.dev' });

    expect(cursorResult.files.length).toBeGreaterThan(0);
    expect(codexResult.files.length).toBeGreaterThan(0);
  });
});
