import { describe, expect, it } from 'vitest';
import { getStatusViewHtml } from '../../../src/mcp/views/status.js';

describe('status view HTML', () => {
  it('returns valid HTML document', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the shared runtime', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('EntendiApp');
    expect(html).toContain('ui/initialize');
  });

  it('contains mastery display elements', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('overall-mastery');
    expect(html).toContain('concept-list');
  });

  it('has host theme fallback variables', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('--color-background-primary');
    expect(html).toContain('--color-text-primary');
  });

  it('uses safe DOM construction', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('createElement');
    expect(html).toContain('textContent');
    expect(html).not.toContain('innerHTML');
  });
});
