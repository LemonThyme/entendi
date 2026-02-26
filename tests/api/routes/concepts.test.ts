import { config } from 'dotenv';
config();

import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const describeWithDb = testDbUrl ? describe : describe.skip;

describeWithDb('API routes (integration)', () => {
  const { app } = createApp(testDbUrl!, { secret: 'test-secret-that-is-at-least-32-chars-long' });

  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('GET /api/concepts returns array of seeded concepts', async () => {
    const res = await app.request('/api/concepts');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(100);
  });

  it('GET /api/concepts?domain=security filters by domain', async () => {
    const res = await app.request('/api/concepts?domain=security');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body.length).toBeGreaterThan(0);
    body.forEach((c: any) => expect(c.domain).toBe('security'));
  });

  it('GET /api/concepts/:id returns concept with edges', async () => {
    const res = await app.request('/api/concepts/react-hooks');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe('react-hooks');
    expect(body.edges).toBeDefined();
  });

  it('GET /api/concepts/:id returns 404 for missing', async () => {
    const res = await app.request('/api/concepts/nonexistent');
    expect(res.status).toBe(404);
  });

  it('GET /api/concepts/:id/prerequisites returns recursive prereqs', async () => {
    const res = await app.request('/api/concepts/react-hooks/prerequisites');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/mastery requires auth (returns 401)', async () => {
    const res = await app.request('/api/mastery');
    expect(res.status).toBe(401);
  });

  it('GET /api/mcp/status requires auth (returns 401)', async () => {
    const res = await app.request('/api/mcp/status');
    expect(res.status).toBe(401);
  });
});
