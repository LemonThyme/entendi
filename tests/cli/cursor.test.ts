import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureCursor } from '../../src/cli/platforms/cursor.js';

describe('configureCursor', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `entendi-cursor-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates .cursor/mcp.json with entendi server config', () => {
    configureCursor(tempDir, { apiKey: 'test-key-123', apiUrl: 'https://api.entendi.dev' });

    const mcpConfig = JSON.parse(readFileSync(join(tempDir, '.cursor', 'mcp.json'), 'utf-8'));
    expect(mcpConfig.mcpServers.entendi).toEqual({
      url: 'https://api.entendi.dev/mcp',
      headers: { 'x-api-key': 'test-key-123' },
    });
  });

  it('merges with existing mcp.json preserving other servers', () => {
    mkdirSync(join(tempDir, '.cursor'), { recursive: true });
    writeFileSync(
      join(tempDir, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          'other-server': { url: 'https://other.dev/mcp' },
        },
      }),
    );

    configureCursor(tempDir, { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });

    const mcpConfig = JSON.parse(readFileSync(join(tempDir, '.cursor', 'mcp.json'), 'utf-8'));
    expect(mcpConfig.mcpServers['other-server']).toEqual({ url: 'https://other.dev/mcp' });
    expect(mcpConfig.mcpServers.entendi).toBeDefined();
  });

  it('overwrites existing entendi config in mcp.json', () => {
    mkdirSync(join(tempDir, '.cursor'), { recursive: true });
    writeFileSync(
      join(tempDir, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          entendi: { url: 'https://old.entendi.dev/mcp', headers: { 'x-api-key': 'old-key' } },
        },
      }),
    );

    configureCursor(tempDir, { apiKey: 'new-key', apiUrl: 'https://api.entendi.dev' });

    const mcpConfig = JSON.parse(readFileSync(join(tempDir, '.cursor', 'mcp.json'), 'utf-8'));
    expect(mcpConfig.mcpServers.entendi.headers['x-api-key']).toBe('new-key');
  });

  it('copies entendi.mdc rules file', () => {
    configureCursor(tempDir, { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });

    const mdcPath = join(tempDir, '.cursor', 'rules', 'entendi.mdc');
    expect(existsSync(mdcPath)).toBe(true);
    const content = readFileSync(mdcPath, 'utf-8');
    expect(content).toContain('entendi');
  });

  it('returns list of files written', () => {
    const result = configureCursor(tempDir, { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });
    expect(result.files).toContain('.cursor/mcp.json');
    expect(result.files).toContain('.cursor/rules/entendi.mdc');
  });
});
