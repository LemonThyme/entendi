import { describe, expect, it } from 'vitest';
import { getProbeViewHtml } from '../../../src/mcp/views/probe.js';

describe('probe view HTML', () => {
  it('returns valid HTML document', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the shared runtime', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('EntendiApp');
  });

  it('is a display-only card with no input fields', () => {
    const html = getProbeViewHtml();
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('submit-btn');
  });

  it('has mastery bar elements', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('mastery-bar');
    expect(html).toContain('mastery-pct');
  });

  it('has decay indicator element', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('decay-indicator');
  });

  it('has context line element', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('context-line');
  });

  it('listens to ontoolresult for record_evaluation updates', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('onToolResult');
    expect(html).toContain('previousMastery');
  });

  it('animates mastery bar on update', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('transition');
  });

  it('uses safe DOM construction', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('createElement');
    expect(html).toContain('textContent');
    expect(html).not.toContain('innerHTML');
  });

  it('has host theme fallback variables', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('--color-background-primary');
    expect(html).toContain('--color-text-primary');
  });
});
