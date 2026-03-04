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

  it('contains probe question area', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('probe-question');
  });

  it('contains answer input', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('probe-answer');
  });

  it('contains dismiss interaction', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('entendi_dismiss');
  });

  it('handles no-probe state', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('no-probe');
  });

  it('uses safe DOM construction', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('createElement');
    expect(html).not.toContain('innerHTML');
  });
});
