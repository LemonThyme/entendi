import { config } from 'dotenv';

config();

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/api/index.js';
import { createApp } from '../../../src/api/index.js';

// --- Unit test helpers (same pattern as codebases.test.ts) ---

function createDbMock(resultQueues: { select?: any[][]; insert?: any[][]; update?: any[][]; delete?: any[][] } = {}) {
  const selectQueue = [...(resultQueues.select ?? [])];
  const insertQueue = [...(resultQueues.insert ?? [])];
  const updateQueue = [...(resultQueues.update ?? [])];
  const deleteQueue = [...(resultQueues.delete ?? [])];

  const makeLink = (queue: any[][]): any => {
    const link: any = {
      from: vi.fn(() => makeLink(queue)),
      where: vi.fn(() => makeLink(queue)),
      set: vi.fn(() => makeLink(queue)),
      values: vi.fn(() => makeLink(queue)),
      returning: vi.fn(() => makeLink(queue)),
      limit: vi.fn(() => Promise.resolve(queue.length > 0 ? queue.shift() : [])),
      // biome-ignore lint/suspicious/noThenProperty: simulates Drizzle thenable query
      then(resolve: any, reject?: any) {
        return Promise.resolve(queue.length > 0 ? queue.shift() : []).then(resolve, reject);
      },
    };
    return link;
  };

  return {
    select: vi.fn(() => makeLink(selectQueue)),
    insert: vi.fn(() => makeLink(insertQueue)),
    update: vi.fn(() => makeLink(updateQueue)),
    delete: vi.fn(() => makeLink(deleteQueue)),
  };
}

function createTestApp(db: any, opts: { userId?: string; orgId?: string | null } = {}) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('db', db as any);
    c.set('auth', {} as any);
    c.set('user', { id: opts.userId ?? 'user-1', name: 'Test', email: 'test@test.com' });
    c.set('session', {
      id: 'sess-1',
      userId: opts.userId ?? 'user-1',
      activeOrganizationId: 'orgId' in opts ? opts.orgId : 'org-1',
    });
    await next();
  });
  return app;
}

async function mountSyllabi(app: Hono<Env>) {
  const { syllabiRoutes } = await import('../../../src/api/routes/syllabi.js');
  app.route('/syllabi', syllabiRoutes);
  return app;
}

describe('Syllabi unit tests', () => {
  // --- GET / (list) ---
  it('GET /syllabi lists syllabi for active org', async () => {
    const rows = [{ id: 's-1', name: 'Intro', orgId: 'org-1', status: 'active' }];
    const db = createDbMock({
      select: [
        [{ role: 'member' }], // requireOrgMembership
        rows,                  // syllabi for org
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Intro');
  });

  it('GET /syllabi returns 403 for non-org-member', async () => {
    const db = createDbMock({
      select: [
        [], // requireOrgMembership: not a member
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi');
    expect(res.status).toBe(403);
  });

  // --- GET /:id (detail) ---
  it('GET /syllabi/:id returns detail', async () => {
    const syllabus = { id: 's-1', name: 'Intro', orgId: 'org-1', status: 'active' };
    const db = createDbMock({
      select: [
        [{ role: 'member' }], // requireOrgMembership
        [syllabus],            // getSyllabusForOrg
        [{ id: 'src-1' }],    // sources
        [{ value: 3 }],       // concept count
        [{ value: 2 }],       // enrollment count
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('Intro');
    expect(body.conceptCount).toBe(3);
    expect(body.enrollmentCount).toBe(2);
  });

  it('GET /syllabi/:id returns 404 for cross-org access', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }], // requireOrgMembership (user is in org-1)
        [],                    // getSyllabusForOrg: not found (syllabus is in org-2)
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-other-org');
    expect(res.status).toBe(404);
  });

  // --- PUT /:id (update) ---
  it('PUT /syllabi/:id updates name', async () => {
    const existing = { id: 's-1', name: 'Old', orgId: 'org-1', status: 'draft' };
    const updated = { ...existing, name: 'New' };
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }], // requirePermission
        [existing],                         // getSyllabusForOrg
        [updated],                          // fetch updated
      ],
      update: [[]],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('New');
  });

  it('PUT /syllabi/:id returns 404 for cross-org access', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }], // requirePermission (user is in org-1)
        [],                                 // getSyllabusForOrg: not found (syllabus in org-2)
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-other-org', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacked' }),
    });
    expect(res.status).toBe(404);
  });

  // --- DELETE /:id ---
  it('DELETE /syllabi/:id deletes syllabus', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }],           // requirePermission
        [{ id: 's-1', orgId: 'org-1' }],             // getSyllabusForOrg
      ],
      delete: [[]],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });

  it('DELETE /syllabi/:id returns 404 for cross-org access', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }], // requirePermission
        [],                                 // getSyllabusForOrg: not found
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-other-org', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  // --- POST /:id/enroll ---
  it('POST /syllabi/:id/enroll enrolls user (201)', async () => {
    const enrollment = { syllabusId: 's-1', userId: 'user-1', enrolledAt: new Date() };
    const db = createDbMock({
      select: [
        [{ role: 'member' }],              // requireOrgMembership
        [{ id: 's-1', orgId: 'org-1' }],  // getSyllabusForOrg
        [],                                 // existing enrollment check (none)
      ],
      insert: [[enrollment]],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-1/enroll', { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.syllabusId).toBe('s-1');
  });

  it('POST /syllabi/:id/enroll returns 404 for cross-org syllabus', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }], // requireOrgMembership (user is in org-1)
        [],                    // getSyllabusForOrg: not found (syllabus in org-2)
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-other-org/enroll', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /syllabi/:id/enroll rejects non-org-member (403)', async () => {
    const db = createDbMock({
      select: [
        [], // requireOrgMembership: not a member
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-1/enroll', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  // --- GET /:id/progress ---
  it('GET /syllabi/:id/progress returns own progress', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }],              // requireOrgMembership
        [{ id: 's-1', orgId: 'org-1' }],  // getSyllabusForOrg
        [{ syllabusId: 's-1', conceptId: 'c-1', importance: 'core', learningObjective: 'L1' }], // concepts
        [{ mu: 2.0 }],                     // userConceptStates for c-1
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-1/progress');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.syllabusId).toBe('s-1');
    expect(body.concepts).toHaveLength(1);
    expect(body.concepts[0].mastery).toBeCloseTo(0.88, 1);
  });

  it('GET /syllabi/:id/progress returns 404 for cross-org syllabus', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }], // requireOrgMembership
        [],                    // getSyllabusForOrg: not found
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-other-org/progress');
    expect(res.status).toBe(404);
  });

  // --- GET /:id/progress/:userId ---
  it('GET /syllabi/:id/progress/:userId returns 404 for cross-org syllabus', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'admin', roleId: null }], // requirePermission
        [],                                 // getSyllabusForOrg: not found
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-other-org/progress/some-user');
    expect(res.status).toBe(404);
  });

  // --- POST /:id/sources ---
  it('POST /syllabi/:id/sources returns 404 for cross-org syllabus', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }], // requirePermission
        [],                                 // getSyllabusForOrg: not found
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-other-org/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'url', sourceUrl: 'https://evil.com' }),
    });
    expect(res.status).toBe(404);
  });

  // --- POST /:id/concepts ---
  it('POST /syllabi/:id/concepts returns 404 for cross-org syllabus', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }], // requirePermission
        [],                                 // getSyllabusForOrg: not found
      ],
    });

    const app = createTestApp(db);
    await mountSyllabi(app);

    const res = await app.request('/syllabi/s-other-org/concepts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conceptId: 'c-1' }),
    });
    expect(res.status).toBe(404);
  });
});

const testDbUrl = process.env.DATABASE_URL;
const testApiKey = process.env.ENTENDI_API_KEY;
const testSecret = process.env.BETTER_AUTH_SECRET;
const canRun = testDbUrl && testApiKey && testSecret && process.env.INTEGRATION_TESTS === '1';
const describeWithDb = canRun ? describe : describe.skip;

describeWithDb('Syllabi API routes (integration)', () => {
  const { app, db: _db } = createApp(testDbUrl!, { secret: testSecret! });
  const headers = { 'Content-Type': 'application/json', 'x-api-key': testApiKey! };

  let syllabusId: string;
  let sourceId: string;
  const testConceptId = 'react-hooks'; // known seeded concept

  // --- POST / (create syllabus) ---

  it('POST /api/syllabi requires auth', async () => {
    const res = await app.request('/api/syllabi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Syllabus' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/syllabi validates name is required', async () => {
    const res = await app.request('/api/syllabi', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe('Validation error');
  });

  it('POST /api/syllabi creates a syllabus', async () => {
    const res = await app.request('/api/syllabi', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Intro to TypeScript', description: 'Learn TS basics' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Intro to TypeScript');
    expect(body.description).toBe('Learn TS basics');
    expect(body.status).toBe('draft');
    syllabusId = body.id;
  });

  // --- GET / (list syllabi) ---

  it('GET /api/syllabi requires auth', async () => {
    const res = await app.request('/api/syllabi');
    expect(res.status).toBe(401);
  });

  it('GET /api/syllabi lists syllabi for active org', async () => {
    const res = await app.request('/api/syllabi', { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    const found = body.find((s: any) => s.id === syllabusId);
    expect(found).toBeDefined();
    expect(found.name).toBe('Intro to TypeScript');
  });

  // --- GET /:id (syllabus detail) ---

  it('GET /api/syllabi/:id requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`);
    expect(res.status).toBe(401);
  });

  it('GET /api/syllabi/:id returns detail with sources and counts', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(syllabusId);
    expect(body.name).toBe('Intro to TypeScript');
    expect(Array.isArray(body.sources)).toBe(true);
    expect(typeof body.conceptCount).toBe('number');
    expect(typeof body.enrollmentCount).toBe('number');
  });

  it('GET /api/syllabi/:id returns 404 for nonexistent', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id', { headers });
    expect(res.status).toBe(404);
  });

  // --- PUT /:id (update syllabus) ---

  it('PUT /api/syllabi/:id requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(401);
  });

  it('PUT /api/syllabi/:id updates fields', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Advanced TypeScript', status: 'active' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('Advanced TypeScript');
    expect(body.status).toBe('active');
  });

  it('PUT /api/syllabi/:id returns 404 for nonexistent', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Nope' }),
    });
    expect(res.status).toBe(404);
  });

  // --- POST /:id/sources (add source) ---

  it('POST /api/syllabi/:id/sources requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'url', sourceUrl: 'https://example.com/syllabus.pdf' }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/syllabi/:id/sources validates sourceType', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceType: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/syllabi/:id/sources adds a source', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceType: 'url', sourceUrl: 'https://example.com/syllabus.pdf' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
    expect(body.sourceType).toBe('url');
    expect(body.sourceUrl).toBe('https://example.com/syllabus.pdf');
    expect(body.extractionStatus).toBe('pending');
    sourceId = body.id;
  });

  it('POST /api/syllabi/:id/sources returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/sources', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceType: 'manual' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /api/syllabi/:id includes added source', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.sources.length).toBeGreaterThan(0);
    const found = body.sources.find((s: any) => s.id === sourceId);
    expect(found).toBeDefined();
  });

  // --- DELETE /:id/sources/:sourceId (remove source) ---

  it('DELETE /api/syllabi/:id/sources/:sourceId removes source', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources/${sourceId}`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });

  it('DELETE /api/syllabi/:id/sources/:sourceId returns 404 for nonexistent', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/sources/nonexistent-id`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(404);
  });

  // --- POST /:id/concepts (add concept) ---

  it('POST /api/syllabi/:id/concepts requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conceptId: testConceptId }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/syllabi/:id/concepts validates input', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/syllabi/:id/concepts returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/concepts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ conceptId: testConceptId }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/syllabi/:id/concepts returns 404 for nonexistent concept', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conceptId: 'nonexistent-concept-xyz' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/syllabi/:id/concepts adds a concept', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conceptId: testConceptId,
        importance: 'core',
        learningObjective: 'Understand React hooks lifecycle',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.conceptId).toBe(testConceptId);
    expect(body.syllabusId).toBe(syllabusId);
    expect(body.importance).toBe('core');
    expect(body.learningObjective).toBe('Understand React hooks lifecycle');
    expect(body.autoExtracted).toBe(false);
  });

  // --- DELETE /:id/concepts/:conceptId (remove concept) ---

  it('DELETE /api/syllabi/:id/concepts/:conceptId removes concept', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts/${testConceptId}`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });

  it('DELETE /api/syllabi/:id/concepts/:conceptId returns 404 for nonexistent', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts/nonexistent-concept`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(404);
  });

  // Re-add concept for progress tests
  it('re-add concept for progress tests', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/concepts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conceptId: testConceptId, importance: 'core' }),
    });
    expect(res.status).toBe(201);
  });

  // --- POST /:id/enroll (self-enroll) ---

  it('POST /api/syllabi/:id/enroll requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/enroll`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/syllabi/:id/enroll returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/enroll', {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/syllabi/:id/enroll enrolls the user', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/enroll`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.syllabusId).toBe(syllabusId);
    expect(body.userId).toBeDefined();
  });

  it('POST /api/syllabi/:id/enroll rejects duplicate enrollment', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/enroll`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toContain('Already enrolled');
  });

  // --- GET /:id/progress (own progress) ---

  it('GET /api/syllabi/:id/progress requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/progress`);
    expect(res.status).toBe(401);
  });

  it('GET /api/syllabi/:id/progress returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/progress', { headers });
    expect(res.status).toBe(404);
  });

  it('GET /api/syllabi/:id/progress returns own progress', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}/progress`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.syllabusId).toBe(syllabusId);
    expect(body.userId).toBeDefined();
    expect(Array.isArray(body.concepts)).toBe(true);
    expect(body.concepts.length).toBeGreaterThan(0);

    const cp = body.concepts[0];
    expect(typeof cp.conceptId).toBe('string');
    expect(typeof cp.mastery).toBe('number');
    expect(typeof cp.threshold).toBe('number');
    expect(typeof cp.met).toBe('boolean');
    expect(cp.importance).toBe('core');
    expect(cp.threshold).toBe(0.8); // core threshold

    expect(typeof body.completionRatio).toBe('number');
    expect(body.completionRatio).toBeGreaterThanOrEqual(0);
    expect(body.completionRatio).toBeLessThanOrEqual(1);
  });

  // --- GET /:id/progress/:userId (member progress) ---

  it('GET /api/syllabi/:id/progress/:userId returns member progress', async () => {
    const meRes = await app.request('/api/me', { headers });
    const me = await meRes.json() as any;
    const userId = me.user.id;

    const res = await app.request(`/api/syllabi/${syllabusId}/progress/${userId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.syllabusId).toBe(syllabusId);
    expect(body.userId).toBe(userId);
    expect(Array.isArray(body.concepts)).toBe(true);
  });

  it('GET /api/syllabi/:id/progress/:userId returns 404 for nonexistent syllabus', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id/progress/some-user', { headers });
    expect(res.status).toBe(404);
  });

  // --- DELETE /:id (delete syllabus) ---

  it('DELETE /api/syllabi/:id requires auth', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/syllabi/:id returns 404 for nonexistent', async () => {
    const res = await app.request('/api/syllabi/nonexistent-id', {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/syllabi/:id deletes the syllabus', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, {
      method: 'DELETE',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });

  it('GET /api/syllabi/:id returns 404 after deletion', async () => {
    const res = await app.request(`/api/syllabi/${syllabusId}`, { headers });
    expect(res.status).toBe(404);
  });
});
