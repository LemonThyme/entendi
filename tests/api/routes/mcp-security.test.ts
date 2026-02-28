import { config } from 'dotenv';

config();

import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const testApiKey = process.env.ENTENDI_API_KEY;
const testSecret = process.env.BETTER_AUTH_SECRET;
// Integration tests require matching API key + secret + DB. Only run when explicitly opted in.
const canRun = testDbUrl && testApiKey && testSecret && process.env.INTEGRATION_TESTS === '1';
const describeWithDb = canRun ? describe : describe.skip;

describeWithDb('MCP security: probe tokens, evaluation validation, dismiss tracking', () => {
  const { app } = createApp(testDbUrl!, { secret: testSecret! });
  const headers = { 'Content-Type': 'application/json', 'x-api-key': testApiKey! };

  // --- Task 3: Observe returns probeToken when shouldProbe is true ---

  it('observe response includes probeToken when shouldProbe is true', async () => {
    const res = await app.request('/api/mcp/observe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        concepts: [{ id: 'test-security-novel-' + Date.now(), source: 'llm' }],
        triggerContext: 'testing probe tokens',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // If shouldProbe is true, token must be present
    if (body.shouldProbe) {
      expect(body.probeToken).toBeDefined();
      expect(body.probeToken.tokenId).toBeDefined();
      expect(body.probeToken.signature).toBeDefined();
      expect(body.probeToken.conceptId).toBeDefined();
      expect(body.probeToken.userId).toBeDefined();
      expect(body.probeToken.expiresAt).toBeDefined();
      expect(body.probeToken.issuedAt).toBeDefined();
    }
  });

  // --- Task 4: record-evaluation token validation ---

  it('record-evaluation rejects probe event without probeToken', async () => {
    const res = await app.request('/api/mcp/record-evaluation', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conceptId: 'redis',
        score: 3,
        confidence: 0.9,
        reasoning: 'I know redis',
        eventType: 'probe',
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain('token');
  });

  it('record-evaluation rejects probe event with invalid signature', async () => {
    const res = await app.request('/api/mcp/record-evaluation', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conceptId: 'redis',
        score: 3,
        confidence: 0.9,
        reasoning: 'I know redis',
        eventType: 'probe',
        probeToken: {
          tokenId: 'fake-token-id',
          userId: 'fake-user',
          conceptId: 'redis',
          depth: 1,
          evaluationCriteria: '',
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          signature: 'bad-signature',
        },
        responseText: 'my response about redis',
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain('invalid_signature');
  });

  it('record-evaluation accepts tutor_phase1 without probeToken', async () => {
    // Ensure the concept exists first
    const conceptId = 'test-tutor-no-token-' + Date.now();
    await app.request('/api/mcp/observe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        concepts: [{ id: conceptId, source: 'llm' }],
        triggerContext: 'setup for tutor test',
      }),
    });

    const res = await app.request('/api/mcp/record-evaluation', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conceptId,
        score: 2,
        confidence: 0.8,
        reasoning: 'decent understanding',
        eventType: 'tutor_phase1',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.mastery).toBeDefined();
    expect(typeof body.mastery).toBe('number');
  });

  // --- Task 5: Dismiss tracking ---

  it('dismiss records a dismissal event when pending action is awaiting_probe_response', async () => {
    // First observe to create a pending action with a probe token
    const conceptId = 'test-dismiss-tracking-' + Date.now();
    const observeRes = await app.request('/api/mcp/observe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        concepts: [{ id: conceptId, source: 'llm' }],
        triggerContext: 'testing dismiss tracking',
      }),
    });
    const observed = await observeRes.json() as any;

    // Dismiss
    const res = await app.request('/api/mcp/dismiss', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.acknowledged).toBe(true);
    // If the observe triggered a probe, we should have a dismissal recorded
    if (observed.shouldProbe) {
      expect(body.dismissalRecorded).toBe(true);
    }
  });
});
