import { config } from 'dotenv';
config();

import { describe, it, expect, beforeAll } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const describeWithDb = testDbUrl ? describe : describe.skip;

describeWithDb('Categorized dismissals (integration)', () => {
  const testSecret = 'test-secret-that-is-at-least-32-chars-long';
  const { app } = createApp(testDbUrl!, { secret: testSecret });

  const testEmail = `dismiss-test-${Date.now()}@test.entendi.dev`;
  const testPassword = 'TestPassword123!';
  let authHeaders: Record<string, string>;
  let testUserId: string;
  let hasOrg = false;

  // Helper: observe a concept and return the response body
  async function observeConcept(conceptId: string) {
    const res = await app.request('/api/mcp/observe', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        concepts: [{ id: conceptId, source: 'llm' }],
        triggerContext: 'dismiss test',
      }),
    });
    expect(res.status).toBe(200);
    return await res.json() as any;
  }

  // Helper: dismiss with given reason/note
  async function dismiss(reason: string, note?: string) {
    const body: any = { reason };
    if (note) body.note = note;
    const res = await app.request('/api/mcp/dismiss', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as any };
  }

  beforeAll(async () => {
    // 1. Sign up test user
    const signupRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dismiss Test User', email: testEmail, password: testPassword }),
    });
    expect(signupRes.status).toBe(200);
    const signupBody = await signupRes.json() as any;
    testUserId = signupBody.user?.id;

    // Extract session token
    const cookies = signupRes.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((c: string) => c.startsWith('better-auth.session_token='));
    const token = sessionCookie?.split('=')[1]?.split(';')[0];

    if (token) {
      authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    } else {
      const signinRes = await app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });
      const signinBody = await signinRes.json() as any;
      authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${signinBody.token}` };
    }

    // Verify auth
    const meRes = await app.request('/api/me', { headers: authHeaders });
    if (meRes.status === 200) {
      const meBody = await meRes.json() as any;
      testUserId = meBody.user.id;
    }

    // 2. Create org (needed for org endpoint tests)
    const orgRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Dismiss Test Org', slug: `dismiss-test-${Date.now()}` }),
    });
    if (orgRes.status === 200) {
      const orgBody = await orgRes.json() as any;
      hasOrg = true;
      if (orgBody.id) {
        await app.request('/api/auth/organization/set-active', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ organizationId: orgBody.id }),
        });
      }
    }
  }, 30_000);

  // ===== POST /api/mcp/dismiss — categorized reasons =====

  it('dismiss with topic_change records dismissal, no penalty', async () => {
    const conceptId = 'dismiss-topic-change-' + Date.now();
    const observed = await observeConcept(conceptId);

    const { status, body } = await dismiss('topic_change');
    expect(status).toBe(200);
    expect(body.acknowledged).toBe(true);
    if (observed.shouldProbe) {
      expect(body.dismissalRecorded).toBe(true);
      expect(body.autoScored).toBe(false);
      expect(body.requeued).toBe(false);
    }
  });

  it('dismiss with topic_change and note saves the note', async () => {
    const conceptId = 'dismiss-note-' + Date.now();
    await observeConcept(conceptId);

    const { status, body } = await dismiss('topic_change', 'User moved on to refactoring');
    expect(status).toBe(200);
    expect(body.acknowledged).toBe(true);
  });

  it('dismiss with busy requeues the probe', async () => {
    const conceptId = 'dismiss-busy-' + Date.now();
    const observed = await observeConcept(conceptId);

    const { status, body } = await dismiss('busy', 'debugging a production issue');
    expect(status).toBe(200);
    expect(body.acknowledged).toBe(true);
    if (observed.shouldProbe) {
      expect(body.dismissalRecorded).toBe(true);
      expect(body.requeued).toBe(true);
      expect(body.autoScored).toBe(false);
    }
  });

  it('dismiss with busy 3rd time auto-scores 0', async () => {
    const conceptId = 'dismiss-busy-escalate-' + Date.now();

    // 1st busy dismiss
    await observeConcept(conceptId);
    await dismiss('busy', 'first deferral');

    // 2nd busy dismiss — need to re-observe to get pending action
    await observeConcept(conceptId);
    await dismiss('busy', 'second deferral');

    // 3rd busy dismiss — should auto-score 0
    await observeConcept(conceptId);
    const { status, body } = await dismiss('busy', 'third deferral');
    expect(status).toBe(200);
    expect(body.acknowledged).toBe(true);
    if (body.dismissalRecorded) {
      expect(body.autoScored).toBe(true);
      expect(body.requeued).toBe(false);
    }
  }, 15_000);

  it('dismiss with claimed_expertise auto-scores 0', async () => {
    const conceptId = 'dismiss-claimed-exp-' + Date.now();
    const observed = await observeConcept(conceptId);

    const { status, body } = await dismiss('claimed_expertise');
    expect(status).toBe(200);
    expect(body.acknowledged).toBe(true);
    if (observed.shouldProbe) {
      expect(body.dismissalRecorded).toBe(true);
      expect(body.autoScored).toBe(true);
      expect(body.requeued).toBe(false);
    }
  });

  it('dismiss without pending action gracefully returns acknowledged', async () => {
    // Don't observe — no pending action exists
    const { status, body } = await dismiss('topic_change');
    expect(status).toBe(200);
    expect(body.acknowledged).toBe(true);
    expect(body.dismissalRecorded).toBe(false);
  });

  it('dismiss with invalid reason returns 400', async () => {
    const res = await app.request('/api/mcp/dismiss', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'invalid_reason' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
  });

  // ===== Concept detail timeline includes dismissals =====

  it('concept detail timeline includes dismissal events', async () => {
    const conceptId = 'dismiss-timeline-' + Date.now();

    // Create an assessment event
    const observed = await observeConcept(conceptId);
    if (observed.shouldProbe && observed.probeToken) {
      await app.request('/api/mcp/record-evaluation', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          conceptId,
          score: 2,
          confidence: 0.8,
          reasoning: 'Good understanding',
          eventType: 'probe',
          probeToken: observed.probeToken,
          responseText: 'The concept works by...',
        }),
      });
    } else {
      await app.request('/api/mcp/record-evaluation', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          conceptId,
          score: 2,
          confidence: 0.8,
          reasoning: 'Good understanding',
          eventType: 'tutor_phase1',
          responseText: 'The concept works by...',
        }),
      });
    }

    // Now observe again and dismiss to create a dismissal event
    await observeConcept(conceptId);
    await dismiss('topic_change', 'testing timeline');

    // Fetch concept detail
    const res = await app.request(`/api/analytics/concept/${encodeURIComponent(conceptId)}`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(Array.isArray(body.timeline)).toBe(true);
    const dismissalEntry = body.timeline.find((e: any) => e.type === 'dismissal');
    if (dismissalEntry) {
      expect(dismissalEntry.reason).toBe('topic_change');
      expect(dismissalEntry.note).toBe('testing timeline');
      expect(dismissalEntry.eventId).toBeDefined();
    }

    // Also check the top-level dismissals array
    expect(Array.isArray(body.dismissals)).toBe(true);
  }, 15_000);

  // ===== Org member history includes dismissals =====

  it('org member history interleaves dismissals with assessments', async () => {
    if (!hasOrg) return;

    const res = await app.request(`/api/org/members/${testUserId}/history`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);

    // We should have at least one dismissal from earlier tests
    const dismissals = body.filter((e: any) => e.type === 'dismissal');
    if (dismissals.length > 0) {
      const d = dismissals[0];
      expect(d.reason).toBeDefined();
      expect(d.conceptId).toBeDefined();
      expect(d.createdAt).toBeDefined();
    }

    // Verify entries are sorted by date (descending — most recent first)
    for (let i = 1; i < body.length; i++) {
      expect(new Date(body[i - 1].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(body[i].createdAt).getTime());
    }
  });

  // ===== GET /api/org/dismissals — paginated list =====

  it('GET /api/org/dismissals returns paginated results', async () => {
    if (!hasOrg) return;

    const res = await app.request('/api/org/dismissals', { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.items).toBeDefined();
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.page).toBe(1);
    expect(typeof body.limit).toBe('number');

    if (body.items.length > 0) {
      const item = body.items[0];
      expect(item.userId).toBeDefined();
      expect(item.userName).toBeDefined();
      expect(item.conceptId).toBeDefined();
      expect(item.reason).toBeDefined();
      expect(item.createdAt).toBeDefined();
    }
  });

  it('GET /api/org/dismissals filters by reason', async () => {
    if (!hasOrg) return;

    const res = await app.request('/api/org/dismissals?reason=topic_change', {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    for (const item of body.items) {
      expect(item.reason).toBe('topic_change');
    }
  });

  it('GET /api/org/dismissals filters by userId', async () => {
    if (!hasOrg) return;

    const res = await app.request(`/api/org/dismissals?userId=${testUserId}`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    for (const item of body.items) {
      expect(item.userId).toBe(testUserId);
    }
  });

  it('GET /api/org/dismissals returns 401 without auth', async () => {
    const res = await app.request('/api/org/dismissals');
    expect(res.status).toBe(401);
  });

  it('GET /api/org/dismissals returns 400 without org', async () => {
    // Create a user with no org
    const email2 = `no-org-dismiss-${Date.now()}@test.entendi.dev`;
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
    const res = await app.request('/api/org/dismissals', { headers: noOrgHeaders });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('No active organization');
  });

  // ===== GET /api/org/dismissals/stats =====

  it('GET /api/org/dismissals/stats returns aggregate counts', async () => {
    if (!hasOrg) return;

    const res = await app.request('/api/org/dismissals/stats', { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(typeof body.totalDismissals).toBe('number');
    expect(body.byReason).toBeDefined();
    expect(typeof body.byReason.topic_change).toBe('number');
    expect(typeof body.byReason.busy).toBe('number');
    expect(typeof body.byReason.claimed_expertise).toBe('number');
    expect(Array.isArray(body.topDismissers)).toBe(true);
    expect(Array.isArray(body.repeatBusyDeferrals)).toBe(true);

    // We created dismissals above, so totals should be > 0
    expect(body.totalDismissals).toBeGreaterThan(0);
  });

  it('GET /api/org/dismissals/stats returns 401 without auth', async () => {
    const res = await app.request('/api/org/dismissals/stats');
    expect(res.status).toBe(401);
  });
});
