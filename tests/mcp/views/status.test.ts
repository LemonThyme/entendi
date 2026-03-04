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
  });

  it('has sigma overlay elements', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('sigma-overlay');
  });

  it('has urgency-based rendering', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('urgency');
  });

  it('has weekly activity in header', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('weeklyActivity');
  });

  it('has summary footer', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('footer');
  });

  it('uses safe DOM construction', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('createElement');
    expect(html).toContain('textContent');
    expect(html).not.toContain('innerHTML');
  });

  it('has host theme fallback variables', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('--color-background-primary');
    expect(html).toContain('--color-text-primary');
  });
});
