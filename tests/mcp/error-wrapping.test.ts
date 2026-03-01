import { describe, expect, it } from 'vitest';
import { wrapToolError } from '../../src/mcp/server.js';

describe('wrapToolError', () => {
  it('wraps circuit breaker errors', () => {
    const msg = wrapToolError(new Error('Circuit breaker OPEN — failing fast'));
    expect(msg).toContain('temporarily unavailable');
    expect(msg).toContain('resume automatically');
    expect(msg).not.toContain('Circuit breaker');
  });

  it('wraps connection refused errors', () => {
    const msg = wrapToolError(new Error('fetch failed: ECONNREFUSED'));
    expect(msg).toContain("Can't reach");
    expect(msg).not.toContain('ECONNREFUSED');
  });

  it('wraps timeout errors', () => {
    const msg = wrapToolError(new DOMException('The operation was aborted', 'AbortError'));
    expect(msg).toContain("Can't reach");
  });

  it('wraps ETIMEDOUT errors', () => {
    const msg = wrapToolError(new Error('connect ETIMEDOUT 1.2.3.4'));
    expect(msg).toContain("Can't reach");
  });

  it('wraps generic fetch failed errors', () => {
    const msg = wrapToolError(new Error('fetch failed'));
    expect(msg).toContain("Can't reach");
  });

  it('wraps 401 errors', () => {
    const msg = wrapToolError(new Error('HTTP 401: Unauthorized'));
    expect(msg).toContain('expired');
    expect(msg).toContain('entendi_login');
  });

  it('wraps 403 errors', () => {
    const msg = wrapToolError(new Error('HTTP 403: Forbidden'));
    expect(msg).toContain('expired');
    expect(msg).toContain('entendi_login');
  });

  it('wraps 429 errors', () => {
    const msg = wrapToolError(new Error('HTTP 429: Too Many Requests'));
    expect(msg).toContain('Rate limit');
  });

  it('wraps 500 errors', () => {
    const msg = wrapToolError(new Error('HTTP 500: Internal Server Error'));
    expect(msg).toContain('server error');
    expect(msg).toContain('continues normally');
  });

  it('wraps 502 errors', () => {
    const msg = wrapToolError(new Error('HTTP 502: Bad Gateway'));
    expect(msg).toContain('server error');
  });

  it('wraps token validation errors', () => {
    const msg = wrapToolError(new Error('Probe token expired'));
    expect(msg).toContain('expired');
    expect(msg).toContain('new one');
  });

  it('wraps invalid token errors', () => {
    const msg = wrapToolError(new Error('Probe token invalid'));
    expect(msg).toContain('expired');
    expect(msg).toContain('new one');
  });

  it('returns generic message for unknown errors', () => {
    const msg = wrapToolError(new Error('some random error'));
    expect(msg).toContain('unexpected error');
    expect(msg).toContain('continues normally');
  });

  it('handles non-Error values', () => {
    const msg = wrapToolError('string error');
    expect(msg).toContain('unexpected error');
  });

  it('handles null/undefined', () => {
    const msg = wrapToolError(null);
    expect(msg).toContain('unexpected error');
  });
});
