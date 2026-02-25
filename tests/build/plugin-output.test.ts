import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const pluginDir = join(process.cwd(), 'dist', 'plugin');

describe('plugin build output', () => {
  it('has plugin manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8'),
    );
    expect(manifest.name).toBe('entendi');
    expect(manifest.version).toBeDefined();
  });

  it('has MCP config with CLAUDE_PLUGIN_ROOT', () => {
    const mcp = JSON.parse(
      readFileSync(join(pluginDir, '.mcp.json'), 'utf-8'),
    );
    expect(mcp.entendi).toBeDefined();
    expect(mcp.entendi.args[0]).toContain('${CLAUDE_PLUGIN_ROOT}');
  });

  it('has hooks config with CLAUDE_PLUGIN_ROOT', () => {
    const hooks = JSON.parse(
      readFileSync(join(pluginDir, 'hooks', 'hooks.json'), 'utf-8'),
    );
    expect(hooks.hooks.PostToolUse).toBeDefined();
    expect(hooks.hooks.UserPromptSubmit).toBeDefined();
    const cmd = hooks.hooks.PostToolUse[0].hooks[0].command;
    expect(cmd).toContain('${CLAUDE_PLUGIN_ROOT}');
  });

  it('has bundled MCP server', () => {
    expect(existsSync(join(pluginDir, 'mcp', 'server.js'))).toBe(true);
  });

  it('has bundled hook scripts', () => {
    expect(existsSync(join(pluginDir, 'hooks', 'post-tool-use.js'))).toBe(true);
    expect(existsSync(join(pluginDir, 'hooks', 'user-prompt-submit.js'))).toBe(true);
  });

  it('does not include non-entrypoint hook files', () => {
    expect(existsSync(join(pluginDir, 'hooks', 'shared.js'))).toBe(false);
  });
});
