import { describe, expect, it } from 'vitest';
import { getViewRuntime } from '../../../src/mcp/views/runtime.js';

describe('view runtime', () => {
  it('exports a non-empty JS string', () => {
    const js = getViewRuntime();
    expect(typeof js).toBe('string');
    expect(js.length).toBeGreaterThan(100);
  });

  it('contains ui/initialize request', () => {
    const js = getViewRuntime();
    expect(js).toContain('ui/initialize');
  });

  it('contains postMessage transport', () => {
    const js = getViewRuntime();
    expect(js).toContain('postMessage');
  });

  it('contains auto-resize observer', () => {
    const js = getViewRuntime();
    expect(js).toContain('ResizeObserver');
  });

  it('contains theme application', () => {
    const js = getViewRuntime();
    expect(js).toContain('--color-background-primary');
  });
});
