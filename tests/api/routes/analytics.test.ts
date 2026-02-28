import { config } from 'dotenv';

config();

import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const testSecret = process.env.BETTER_AUTH_SECRET;
const canRun = testDbUrl && testSecret && process.env.INTEGRATION_TESTS === '1';
const describeWithDb = canRun ? describe : describe.skip;

describeWithDb('Analytics API routes', () => {
  const { app } = createApp(testDbUrl!, { secret: testSecret! });

  it('GET /api/analytics/timeline returns 401 without auth', async () => {
    const res = await app.request('/api/analytics/timeline');
    expect(res.status).toBe(401);
  });

  it('GET /api/analytics/velocity returns 401 without auth', async () => {
    const res = await app.request('/api/analytics/velocity');
    expect(res.status).toBe(401);
  });

  it('GET /api/analytics/activity-heatmap returns 401 without auth', async () => {
    const res = await app.request('/api/analytics/activity-heatmap');
    expect(res.status).toBe(401);
  });

  it('GET /api/analytics/concept/:id returns 401 without auth', async () => {
    const res = await app.request('/api/analytics/concept/react-hooks');
    expect(res.status).toBe(401);
  });
});
