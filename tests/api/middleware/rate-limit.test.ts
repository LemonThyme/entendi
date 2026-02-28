import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../../src/api/index.js';
import { rateLimit, resetRateLimitStore } from '../../../src/api/middleware/rate-limit.js';

function createTestApp(max: number, windowMs = 60_000) {
  const app = new Hono<Env>();

  // Minimal user stub
  app.use('*', async (c, next) => {
    c.set('user', { id: 'test-user', name: 'Test', email: 'test@test.com' });
    c.set('session', null);
    c.set('db', null as any);
    c.set('auth', null as any);
    await next();
  });

  app.use('*', rateLimit({ windowMs, max }));
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('allows requests under the limit', async () => {
    const app = createTestApp(5);
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('returns 429 when limit exceeded', async () => {
    const app = createTestApp(3);
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/test');
      expect(res.status).toBe(200);
    }
    const res = await app.request('/test');
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('Too many requests');
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('uses custom key function', async () => {
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('user', null);
      c.set('session', null);
      c.set('db', null as any);
      c.set('auth', null as any);
      await next();
    });
    app.use('*', rateLimit({
      windowMs: 60_000,
      max: 2,
      keyFn: () => 'shared-key',
    }));
    app.get('/test', (c) => c.json({ ok: true }));

    await app.request('/test');
    await app.request('/test');
    const res = await app.request('/test');
    expect(res.status).toBe(429);
  });

  it('decrements remaining count correctly', async () => {
    const app = createTestApp(5);

    const r1 = await app.request('/test');
    expect(r1.headers.get('X-RateLimit-Remaining')).toBe('4');

    const r2 = await app.request('/test');
    expect(r2.headers.get('X-RateLimit-Remaining')).toBe('3');

    const r3 = await app.request('/test');
    expect(r3.headers.get('X-RateLimit-Remaining')).toBe('2');
  });
});
