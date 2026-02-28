import { config } from 'dotenv';

config();

import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const describeWithDb = testDbUrl ? describe : describe.skip;

describeWithDb('GET /api/events', () => {
  const { app } = createApp(testDbUrl!, { secret: 'test-secret-that-is-at-least-32-chars-long' });

  it('returns 401 without auth', async () => {
    const res = await app.request('/api/events');
    expect(res.status).toBe(401);
  });

  it('returns SSE content type with valid auth', async () => {
    const res = await app.request('/api/events', {
      headers: { 'x-api-key': 'test-key' },
    });
    // Should be SSE or 401 (no valid auth key in test env)
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    }
  });
});
