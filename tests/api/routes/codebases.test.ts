import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/api/index.js';

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

function createApp(db: any, opts: { userId?: string; orgId?: string | null } = {}) {
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

async function mountCodebases(app: Hono<Env>) {
  const { codebaseRoutes } = await import('../../../src/api/routes/codebases.js');
  app.route('/codebases', codebaseRoutes);
  return app;
}

describe('Codebases CRUD API', () => {
  // --- POST / (create codebase) ---
  // requirePermission does: select member.limit(1), then route does: insert + select created
  it('POST /codebases creates a codebase (201)', async () => {
    const codebase = {
      id: 'cb-1', name: 'My Repo', orgId: 'org-1', status: 'draft',
      syncStatus: 'idle', createdAt: new Date(),
    };
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }], // requirePermission: member lookup
        [codebase],                          // fetch created codebase
      ],
      insert: [[]],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Repo' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.name).toBe('My Repo');
  });

  it('POST /codebases validates name required (400)', async () => {
    const db = createDbMock({
      select: [[{ role: 'owner', roleId: null }]],
    });
    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /codebases rejects non-permitted member (403)', async () => {
    const db = createDbMock({
      select: [[{ role: 'member', roleId: null }]],
    });
    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hack' }),
    });
    expect(res.status).toBe(403);
  });

  // --- GET / (list codebases) ---
  // requireOrgMembership: select member.limit(1), then: select codebases
  it('GET /codebases lists codebases for active org', async () => {
    const rows = [
      { id: 'cb-1', name: 'Repo A', orgId: 'org-1', status: 'active' },
    ];
    const db = createDbMock({
      select: [
        [{ role: 'member' }], // requireOrgMembership: member lookup
        rows,                  // codebases for org
        [],                    // concepts for cb-1
        [],                    // enrollments for cb-1
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Repo A');
  });

  it('GET /codebases returns 400 with no active org', async () => {
    const db = createDbMock();
    const app = createApp(db, { orgId: null });
    await mountCodebases(app);

    const res = await app.request('/codebases');
    expect(res.status).toBe(400);
  });

  // --- GET /:id (detail) ---
  // requireOrgMembership: member.limit(1), getCodebaseForOrg: codebases, concepts, enrollments
  it('GET /codebases/:id returns detail', async () => {
    const codebase = { id: 'cb-1', name: 'Repo', orgId: 'org-1', status: 'active' };
    const db = createDbMock({
      select: [
        [{ role: 'member' }], // requireOrgMembership
        [codebase],            // getCodebaseForOrg
        [{ codebaseId: 'cb-1', conceptId: 'c-1', importance: 'core' }], // concepts
        [{ codebaseId: 'cb-1', userId: 'u-1' }, { codebaseId: 'cb-1', userId: 'u-2' }], // enrollments
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('Repo');
    expect(body.concepts).toHaveLength(1);
    expect(body.enrollmentCount).toBe(2);
  });

  it('GET /codebases/:id returns 404 for nonexistent', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }], // requireOrgMembership
        [],                    // getCodebaseForOrg: not found
      ],
    });
    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/nonexistent');
    expect(res.status).toBe(404);
  });

  // --- PUT /:id (update) ---
  // requirePermission: member.limit(1), getCodebaseForOrg, update, select updated
  it('PUT /codebases/:id updates name and status', async () => {
    const existing = { id: 'cb-1', name: 'Old', orgId: 'org-1', status: 'draft' };
    const updated = { ...existing, name: 'New', status: 'active' };
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }], // requirePermission
        [existing],                         // getCodebaseForOrg
        [updated],                          // fetch updated
      ],
      update: [[]],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New', status: 'active' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('New');
  });

  // --- DELETE /:id ---
  it('DELETE /codebases/:id deletes codebase', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }],           // requirePermission
        [{ id: 'cb-1', orgId: 'org-1' }], // getCodebaseForOrg
      ],
      delete: [[]],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });

  // --- POST /:id/activate ---
  it('POST /codebases/:id/activate sets status to active', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'admin', roleId: null }],                     // requirePermission
        [{ id: 'cb-1', orgId: 'org-1', status: 'draft' }],    // getCodebaseForOrg
      ],
      update: [[]],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/activate', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('active');
  });

  // --- POST /:id/concepts ---
  it('POST /codebases/:id/concepts adds concept (201)', async () => {
    const created = { codebaseId: 'cb-1', conceptId: 'c-1', importance: 'core' };
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }],          // requirePermission
        [{ id: 'cb-1', orgId: 'org-1' }],           // getCodebaseForOrg
        [{ id: 'c-1', domain: 'typescript' }],       // concept lookup
      ],
      insert: [[created]], // insert returning
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/concepts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conceptId: 'c-1', importance: 'core', learningObjective: 'Learn TS' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.conceptId).toBe('c-1');
  });

  it('POST /codebases/:id/concepts returns 404 for nonexistent concept', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }], // requirePermission
        [{ id: 'cb-1', orgId: 'org-1' }],  // getCodebaseForOrg
        [],                                  // concept not found
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/concepts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conceptId: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  // --- DELETE /:id/concepts/:conceptId ---
  it('DELETE /codebases/:id/concepts/:conceptId removes concept', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }],            // requirePermission
        [{ id: 'cb-1', orgId: 'org-1' }],             // getCodebaseForOrg
        [{ codebaseId: 'cb-1', conceptId: 'c-1' }],   // existing concept
      ],
      delete: [[]],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/concepts/c-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  // --- GET /:id/concepts (with mastery) ---
  // requireOrgMembership: member.limit(1), getCodebaseForOrg, codebaseConcepts, then per-concept userConceptStates
  it('GET /codebases/:id/concepts returns concepts with mastery data', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }],              // requireOrgMembership
        [{ id: 'cb-1', orgId: 'org-1' }], // getCodebaseForOrg
        [                                   // codebaseConcepts
          { codebaseId: 'cb-1', conceptId: 'c-1', importance: 'core', learningObjective: 'Learn X' },
          { codebaseId: 'cb-1', conceptId: 'c-2', importance: 'peripheral', learningObjective: null },
        ],
        [{ mu: 2.0 }], // userConceptStates for c-1
        [],              // userConceptStates for c-2
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/concepts');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(2);
    // c-1: mu=2.0, pMastery(2.0) ≈ 0.88
    expect(body[0].mastery).toBeCloseTo(0.88, 1);
    expect(body[0].threshold).toBe(0.8);
    expect(body[0].met).toBe(true);
    // c-2: mu=0.0, pMastery(0) = 0.5
    expect(body[1].mastery).toBeCloseTo(0.5, 1);
    expect(body[1].threshold).toBe(0.4);
    expect(body[1].met).toBe(true);
  });

  // --- POST /:id/enroll ---
  // requireOrgMembership: member.limit(1), getCodebaseForOrg, enrollment check, insert+returning
  it('POST /codebases/:id/enroll enrolls user (201)', async () => {
    const enrollment = { codebaseId: 'cb-1', userId: 'user-1', status: 'active', enrolledAt: new Date() };
    const db = createDbMock({
      select: [
        [{ role: 'member' }],              // requireOrgMembership
        [{ id: 'cb-1', orgId: 'org-1' }], // getCodebaseForOrg
        [],                                 // existing enrollment check (none)
      ],
      insert: [[enrollment]],              // insert returning
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/enroll', { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.codebaseId).toBe('cb-1');
  });

  it('POST /codebases/:id/enroll rejects duplicate (409)', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }],                         // requireOrgMembership
        [{ id: 'cb-1', orgId: 'org-1' }],             // getCodebaseForOrg
        [{ codebaseId: 'cb-1', userId: 'user-1' }],   // already enrolled
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/enroll', { method: 'POST' });
    expect(res.status).toBe(409);
  });

  it('POST /codebases/:id/enroll rejects non-org-member (403)', async () => {
    const db = createDbMock({
      select: [
        [], // requireOrgMembership: not a member → 403
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/enroll', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  // --- GET /:id/progress (own progress) ---
  // requireOrgMembership: member.limit(1), getCodebaseForOrg, buildProgress: concepts, per-concept UCS
  it('GET /codebases/:id/progress returns own progress', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }],              // requireOrgMembership
        [{ id: 'cb-1', orgId: 'org-1' }], // getCodebaseForOrg
        [{ codebaseId: 'cb-1', conceptId: 'c-1', importance: 'core', learningObjective: 'L1' }], // concepts
        [{ mu: 2.0 }],                     // userConceptStates for c-1
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/progress');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.codebaseId).toBe('cb-1');
    expect(body.concepts).toHaveLength(1);
    expect(body.concepts[0].mastery).toBeCloseTo(0.88, 1);
    expect(body.completionRatio).toBe(1);
  });

  it('GET /codebases/:id/progress returns empty for no concepts', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }],              // requireOrgMembership
        [{ id: 'cb-1', orgId: 'org-1' }], // getCodebaseForOrg
        [],                                 // no concepts
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/progress');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.concepts).toHaveLength(0);
    expect(body.completionRatio).toBe(0);
  });

  // --- GET /:id/progress/:userId (member progress) ---
  // requirePermission: member.limit(1), getCodebaseForOrg, buildProgress
  it('GET /codebases/:id/progress/:userId returns member progress', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'admin', roleId: null }], // requirePermission
        [{ id: 'cb-1', orgId: 'org-1' }], // getCodebaseForOrg
        [{ codebaseId: 'cb-1', conceptId: 'c-1', importance: 'supporting' }], // concepts
        [],                                 // userConceptStates (none)
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/progress/other-user');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.userId).toBe('other-user');
    expect(body.concepts[0].mastery).toBeCloseTo(0.5, 1);
    expect(body.concepts[0].threshold).toBe(0.6);
    expect(body.concepts[0].met).toBe(false);
  });

  // --- GET /:id/members ---
  // requirePermission: member.limit(1), getCodebaseForOrg, enrollments, then per-member: buildProgress
  it('GET /codebases/:id/members returns enrolled members with progress', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner', roleId: null }],           // requirePermission
        [{ id: 'cb-1', orgId: 'org-1' }],            // getCodebaseForOrg
        [{ codebaseId: 'cb-1', userId: 'u-1', enrolledAt: new Date(), status: 'active' }], // enrollments
        [{ codebaseId: 'cb-1', conceptId: 'c-1', importance: 'core' }], // buildProgress: concepts for u-1
        [{ mu: 3.0 }],                                // buildProgress: UCS for u-1/c-1
      ],
    });

    const app = createApp(db);
    await mountCodebases(app);

    const res = await app.request('/codebases/cb-1/members');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].userId).toBe('u-1');
    expect(body[0].completionRatio).toBe(1);
  });
});
