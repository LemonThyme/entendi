import { config } from 'dotenv';

config();

import { describe, expect, it } from 'vitest';
import { contactSubmissions, pressMentions, waitlistSignups } from '../../../src/api/db/schema.js';
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
});
