import { config } from 'dotenv';

config();

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const describeWithDb = testDbUrl ? describe : describe.skip;

describeWithDb('Event detail + annotations API (integration)', () => {
  const testSecret = 'test-secret-that-is-at-least-32-chars-long';
  const { app } = createApp(testDbUrl!, { secret: testSecret });

  const testEmail = `event-detail-test-${Date.now()}@test.entendi.dev`;
  const testPassword = 'TestPassword123!';
  let authHeaders: Record<string, string>;
  let testUserId: string;
  let testEventId: number;
  let testConceptId: string;
  let annotationId: number;
  let hasOrg = false;

  // --- Setup: create user, org, seed assessment event ---

  beforeAll(async () => {
    // Increase timeout: sign-up + org creation + MCP flow can be slow against real DB
    // 1. Sign up a test user
    const signupRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Event Test User', email: testEmail, password: testPassword }),
    });
    expect(signupRes.status).toBe(200);
    const signupBody = await signupRes.json() as any;
    testUserId = signupBody.user?.id;

    // Extract session token from set-cookie header
    const cookies = signupRes.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((c: string) => c.startsWith('better-auth.session_token='));
    const token = sessionCookie?.split('=')[1]?.split(';')[0];

    if (token) {
      authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    } else {
      // Fallback: sign in to get token
      const signinRes = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });
      const signinBody = await signinRes.json() as any;
      authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${signinBody.token}` };
    }

    // Verify auth works
    const meRes = await app.request('/api/me', { headers: authHeaders });
    if (meRes.status === 200) {
      const meBody = await meRes.json() as any;
      testUserId = meBody.user.id;
    }

    // 2. Create an org and become owner (for org endpoint tests)
    const orgRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Event Detail Test Org', slug: `evt-test-${Date.now()}` }),
    });
    if (orgRes.status === 200) {
      const orgBody = await orgRes.json() as any;
      hasOrg = true;

      // Set active org
      if (orgBody.id) {
        await app.request('/api/auth/organization/set-active', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ organizationId: orgBody.id }),
        });
      }
    }

    // 3. Seed a concept + assessment event via MCP observe + record-evaluation
    testConceptId = 'test-event-detail-' + Date.now();
    const observeRes = await app.request('/api/mcp/observe', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        concepts: [{ id: testConceptId, source: 'llm' }],
        triggerContext: 'testing event detail endpoints',
      }),
    });

    if (observeRes.status === 200) {
      const observeBody = await observeRes.json() as any;

      if (observeBody.shouldProbe && observeBody.probeToken) {
        await app.request('/api/mcp/record-evaluation', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            conceptId: testConceptId,
            score: 2,
            confidence: 0.8,
            reasoning: 'Good understanding for event detail test',
            eventType: 'probe',
            probeToken: observeBody.probeToken,
            responseText: 'This is my test response about the concept',
          }),
        });
      } else {
        // Use tutor_phase1 (no token required)
        await app.request('/api/mcp/record-evaluation', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            conceptId: testConceptId,
            score: 2,
            confidence: 0.8,
            reasoning: 'Good understanding for event detail test',
            eventType: 'tutor_phase1',
            responseText: 'This is my test response about the concept',
          }),
        });
      }
    }

    // 4. Get event ID from timeline
    const timelineRes = await app.request(`/api/analytics/timeline/${encodeURIComponent(testConceptId)}`, {
      headers: authHeaders,
    });
    if (timelineRes.status === 200) {
      const timelineBody = await timelineRes.json() as any;
      if (timelineBody.timeline?.length > 0) {
        const lastEntry = timelineBody.timeline[timelineBody.timeline.length - 1];
        testEventId = lastEntry.eventId;
      }
    }
  }, 30_000);

  afterAll(async () => {
    // Clean up test users created by this test suite
    const { createDb } = await import('../../../src/api/db/connection.js');
    const { user } = await import('../../../src/api/db/schema.js');
    const { like } = await import('drizzle-orm');
    const db = createDb(testDbUrl!);
    await db.delete(user).where(like(user.email, '%event-detail-%@test.entendi.dev'));
    await db.delete(user).where(like(user.email, '%no-org-%@test.entendi.dev'));
    await db.delete(user).where(like(user.email, '%non-author-%@test.entendi.dev'));
  });

  // --- 1. GET /api/events/:eventId — user endpoint ---

  it('returns 401 without auth', async () => {
    const res = await app.request(`/api/events/${testEventId || 1}`);
    expect(res.status).toBe(401);
  });

  it('returns full event data for own event', async () => {
    if (!testEventId) return;
    const res = await app.request(`/api/events/${testEventId}`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.id).toBe(testEventId);
    expect(body.conceptId).toBe(testConceptId);
    expect(body.eventType).toBeDefined();
    expect(typeof body.rubricScore).toBe('number');
    expect(typeof body.evaluatorConfidence).toBe('number');
    expect(typeof body.muBefore).toBe('number');
    expect(typeof body.muAfter).toBe('number');
    expect(body.createdAt).toBeDefined();
    expect(body.conceptName).toBeDefined();
    expect(body.domain).toBeDefined();
  });

  it('returns 404 for nonexistent event', async () => {
    const res = await app.request('/api/events/999999999', { headers: authHeaders });
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-owned event (ownership enforced via WHERE)', async () => {
    // The endpoint filters by userId = authenticatedUser.id, so non-owned
    // events appear as "not found" rather than "forbidden".
    const res = await app.request('/api/events/1', { headers: authHeaders });
    // Event ID 1 belongs to another user → 404
    expect(res.status).toBe(404);
  });

  // --- 2. GET /api/org/events/:eventId — org admin view ---

  it('org event detail returns 401 without auth', async () => {
    const res = await app.request(`/api/org/events/${testEventId || 1}`);
    expect(res.status).toBe(401);
  });

  it('org event detail returns event with annotations for org admin', async () => {
    if (!testEventId || !hasOrg) return;
    const res = await app.request(`/api/org/events/${testEventId}`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.id).toBe(testEventId);
    expect(body.conceptId).toBe(testConceptId);
    expect(body.eventType).toBeDefined();
    expect(typeof body.rubricScore).toBe('number');
    expect(body.domain).toBeDefined();
    expect(Array.isArray(body.annotations)).toBe(true);
    // Full event detail fields
    expect('responseText' in body).toBe(true);
    expect('evaluationCriteria' in body).toBe(true);
    expect('responseFeatures' in body).toBe(true);
    expect('integrityScore' in body).toBe(true);
    expect('tutored' in body).toBe(true);
  });

  it('org event detail returns 404 for nonexistent event', async () => {
    if (!hasOrg) return;
    const res = await app.request('/api/org/events/999999999', { headers: authHeaders });
    expect(res.status).toBe(404);
  });

  it('org event detail returns 400 when user has no org', async () => {
    // Create a second user with no org
    const email2 = `no-org-${Date.now()}@test.entendi.dev`;
    const signup2 = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Org User', email: email2, password: testPassword }),
    });
    if (signup2.status !== 200) return;
    const cookies2 = signup2.headers.getSetCookie?.() ?? [];
    const sessionCookie2 = cookies2.find((c: string) => c.startsWith('better-auth.session_token='));
    const token2 = sessionCookie2?.split('=')[1]?.split(';')[0];
    if (!token2) return;

    const noOrgHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token2}` };
    const res = await app.request(`/api/org/events/${testEventId || 1}`, { headers: noOrgHeaders });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('No active organization');
  });

  // --- 3. POST /api/org/events/:eventId/annotations ---

  it('create annotation returns 401 without auth', async () => {
    const res = await app.request(`/api/org/events/${testEventId || 1}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test annotation' }),
    });
    expect(res.status).toBe(401);
  });

  it('create annotation succeeds for org admin', async () => {
    if (!testEventId || !hasOrg) return;
    const res = await app.request(`/api/org/events/${testEventId}/annotations`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ text: 'This response looks solid' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
    expect(body.text).toBe('This response looks solid');
    expect(body.authorId).toBe(testUserId);
    expect(body.authorName).toBeDefined();
    expect(body.createdAt).toBeDefined();
    annotationId = body.id;
  });

  it('create annotation validates text is required', async () => {
    if (!testEventId || !hasOrg) return;
    const res = await app.request(`/api/org/events/${testEventId}/annotations`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('create annotation returns 404 for nonexistent event', async () => {
    if (!hasOrg) return;
    const res = await app.request('/api/org/events/999999999/annotations', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ text: 'annotation for missing event' }),
    });
    expect(res.status).toBe(404);
  });

  // --- 4. Verify annotation in org event detail ---

  it('org event detail includes the created annotation', async () => {
    if (!annotationId || !testEventId) return;
    const res = await app.request(`/api/org/events/${testEventId}`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.annotations)).toBe(true);
    const found = body.annotations.find((a: any) => a.id === annotationId);
    expect(found).toBeDefined();
    expect(found.text).toBe('This response looks solid');
    expect(found.authorName).toBeDefined();
  });

  // --- 5. DELETE /api/org/annotations/:annotationId ---

  it('delete annotation returns 401 without auth', async () => {
    if (!annotationId) return;
    const res = await app.request(`/api/org/annotations/${annotationId}`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('delete annotation — author can delete own', async () => {
    if (!annotationId) return;
    const res = await app.request(`/api/org/annotations/${annotationId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(res.status).toBe(204);

    // Verify annotation is gone
    if (testEventId) {
      const verifyRes = await app.request(`/api/org/events/${testEventId}`, { headers: authHeaders });
      if (verifyRes.status === 200) {
        const body = await verifyRes.json() as any;
        const found = body.annotations.find((a: any) => a.id === annotationId);
        expect(found).toBeUndefined();
      }
    }
  });

  it('delete annotation returns 404 for nonexistent annotation', async () => {
    const res = await app.request('/api/org/annotations/999999999', {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });

  it('delete annotation returns 403 for non-author', async () => {
    if (!testEventId || !hasOrg) return;

    // Create a new annotation to test non-author deletion
    const createRes = await app.request(`/api/org/events/${testEventId}/annotations`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ text: 'Annotation to test non-author delete' }),
    });
    if (createRes.status !== 201) return;
    const { id: otherAnnotationId } = await createRes.json() as any;

    // Create a second user and add to org
    const email2 = `non-author-${Date.now()}@test.entendi.dev`;
    const signup2 = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Non Author User', email: email2, password: testPassword }),
    });
    if (signup2.status !== 200) return;
    const cookies2 = signup2.headers.getSetCookie?.() ?? [];
    const sessionCookie2 = cookies2.find((c: string) => c.startsWith('better-auth.session_token='));
    const token2 = sessionCookie2?.split('=')[1]?.split(';')[0];
    if (!token2) return;

    const otherHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token2}` };
    const res = await app.request(`/api/org/annotations/${otherAnnotationId}`, {
      method: 'DELETE',
      headers: otherHeaders,
    });
    expect(res.status).toBe(403);

    // Clean up: delete annotation with original user
    await app.request(`/api/org/annotations/${otherAnnotationId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
  });

  // --- 6. Timeline includes eventId ---

  it('timeline endpoint includes eventId in each entry', async () => {
    if (!testConceptId) return;
    const res = await app.request(`/api/analytics/timeline/${encodeURIComponent(testConceptId)}`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.timeline.length).toBeGreaterThan(0);

    for (const entry of body.timeline) {
      expect(entry.eventId).toBeDefined();
      expect(typeof entry.eventId).toBe('number');
      expect(entry.timestamp).toBeDefined();
      expect(entry.eventType).toBeDefined();
      expect(entry.rubricScore).toBeDefined();
    }
  });

  // --- 7. Org member history expanded fields ---

  it('org member history includes responseText, evaluationCriteria, responseFeatures', async () => {
    if (!testUserId || !hasOrg) return;
    const res = await app.request(`/api/org/members/${testUserId}/history`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    const event = body[0];
    expect('responseText' in event).toBe(true);
    expect('evaluationCriteria' in event).toBe(true);
    expect('responseFeatures' in event).toBe(true);
    expect('id' in event).toBe(true);
  });
});
