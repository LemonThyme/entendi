import { describe, expect, it } from 'vitest';
import { getFrontierViewHtml } from '../../../src/mcp/views/frontier.js';

describe('frontier view HTML', () => {
  it('returns valid HTML document', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the shared runtime', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('EntendiApp');
  });

  it('contains frontier display elements', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('frontier-list');
  });

  it('has Start Learning interaction', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('entendi_start_tutor');
  });

  it('uses safe DOM construction', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('createElement');
    expect(html).not.toContain('innerHTML');
  });
});
