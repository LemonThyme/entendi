import { describe, expect, it } from 'vitest';
import { getViewRuntime } from '../../../src/mcp/views/runtime.js';

describe('view runtime', () => {
  it('exports a non-empty JS string', () => {
    const js = getViewRuntime();
    expect(typeof js).toBe('string');
    expect(js.length).toBeGreaterThan(100);
  });

  it('contains the ext-apps App class bundle', () => {
    const js = getViewRuntime();
    expect(js).toContain('McpApps');
  });

  it('contains EntendiApp wrapper', () => {
    const js = getViewRuntime();
    expect(js).toContain('EntendiApp');
  });

  it('contains callServerTool bridge', () => {
    const js = getViewRuntime();
    expect(js).toContain('callServerTool');
  });

  it('contains theme application', () => {
    const js = getViewRuntime();
    expect(js).toContain('--color-background-primary');
  });
});
