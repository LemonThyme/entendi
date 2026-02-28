import { config } from 'dotenv';
config();

import { describe, it, expect } from 'vitest';
import { waitlistSignups, pressMentions, contactSubmissions } from '../../../src/api/db/schema.js';
import { createApp } from '../../../src/api/index.js';

describe('Public page schema', () => {
  it('exports waitlistSignups table', () => {
    expect(waitlistSignups).toBeDefined();
  });

  it('exports pressMentions table', () => {
    expect(pressMentions).toBeDefined();
  });

  it('exports contactSubmissions table', () => {
    expect(contactSubmissions).toBeDefined();
  });
});

const testDbUrl = process.env.DATABASE_URL;
const testSecret = process.env.BETTER_AUTH_SECRET;
const canRun = testDbUrl && testSecret && process.env.INTEGRATION_TESTS === '1';
const describeWithDb = canRun ? describe : describe.skip;

describeWithDb('Public API routes (integration)', () => {
  const { app } = createApp(testDbUrl!, { secret: testSecret! });

  it('POST /api/waitlist accepts valid email', async () => {
    const email = `test-${Date.now()}@example.com`;
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('POST /api/waitlist rejects invalid email', async () => {
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/waitlist returns 409 for duplicate', async () => {
    const email = `dup-${Date.now()}@example.com`;
    await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(409);
  });

  it('GET /api/press returns array', async () => {
    const res = await app.request('/api/press');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/contact accepts valid submission', async () => {
    const res = await app.request('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: 'test@example.com',
        message: 'Hello',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('POST /api/contact rejects missing fields', async () => {
    const res = await app.request('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /privacy returns HTML privacy policy', async () => {
    const res = await app.request('/privacy');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Data We Collect');
    expect(html).toContain('Account information');
    expect(html).toContain('Behavioral biometrics');
    expect(html).toContain('Session cookies');
  });

  it('GET /terms returns HTML terms of service', async () => {
    const res = await app.request('/terms');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Terms of Service');
    expect(html).toContain('Acceptable Use');
    expect(html).toContain('Account Deletion');
  });

  it('DELETE /api/me returns 401 when unauthenticated', async () => {
    const res = await app.request('/api/me', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('Landing page includes SEO meta tags', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('meta name="description"');
    expect(html).toContain('meta property="og:title"');
    expect(html).toContain('meta property="og:description"');
    expect(html).toContain('meta property="og:url"');
    expect(html).toContain('meta property="og:type"');
    expect(html).toContain('meta name="twitter:card"');
  });
});
