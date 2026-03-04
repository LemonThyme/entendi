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

  it('uses sendMessage for Start Learning action', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('sendMessage');
    expect(html).toContain('Teach me about');
  });

  it('does not call entendi_start_tutor directly', () => {
    const html = getFrontierViewHtml();
    expect(html).not.toContain('entendi_start_tutor');
  });

  it('uses actual API field names', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('conceptId');
    expect(html).toContain('fisherInfo');
  });

  it('has footer with additional count', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('more-count');
  });

  it('uses safe DOM construction', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('createElement');
    expect(html).toContain('textContent');
    expect(html).not.toContain('innerHTML');
  });

  it('has host theme fallback variables', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('--color-background-primary');
    expect(html).toContain('--color-text-primary');
  });
});
