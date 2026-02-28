import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

/**
 * Creates a chainable mock that supports: select().from().where().orderBy().limit()
 * Each call returns a new chain link, and any link can be awaited to get the result.
 * Call setResult() to configure what the chain resolves to.
 */
function createDbMock() {
  let defaultResult: any = [];
  let resultQueue: any[] = [];
  let executeQueue: any[] = [];

  function nextResult() {
    if (resultQueue.length > 0) return resultQueue.shift();
    return defaultResult;
  }

  function makeLink(): any {
    // Each link is a thenable that also supports chaining
    let resolved = false;
    const link: any = {
      from: vi.fn(() => makeLink()),
      where: vi.fn(() => makeLink()),
      innerJoin: vi.fn(() => makeLink()),
      orderBy: vi.fn(() => makeLink()),
      limit: vi.fn(() => Promise.resolve(nextResult())),
      then(resolve: any, reject?: any) {
        if (!resolved) { resolved = true; return Promise.resolve(nextResult()).then(resolve, reject); }
        return Promise.resolve(undefined).then(resolve, reject);
      },
    };
    return link;
  }

  const db = {
    select: vi.fn(() => makeLink()),
    execute: vi.fn(() => {
      if (executeQueue.length > 0) return Promise.resolve(executeQueue.shift());
      return Promise.resolve({ rows: [] });
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 1, text: 'test', authorName: 'Test', createdAt: new Date().toISOString() }])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([])),
    })),
    /** Queue a result for the next select chain that is awaited */
    _queueResult: (result: any) => { resultQueue.push(result); },
    _queueExecute: (result: any) => { executeQueue.push(result); },
    _reset: () => { resultQueue = []; executeQueue = []; defaultResult = []; },
  };

  return db;
}

function createTestApp(db: any, opts: { userId?: string; orgId?: string | null } = {}) {
  const userId = opts.userId ?? 'user-1';
  const orgId = opts.orgId ?? 'org-1';
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db as any);
    c.set('auth', {} as any);
    c.set('user', { id: userId, name: 'Test User', email: 'test@test.com' });
    c.set('session', { id: 'sess-1', userId, activeOrganizationId: orgId });
    await next();
  });
  return app;
}

describe('org routes (unit)', () => {
  let db: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
  });

  // --- GET /members ---

  it('GET /members returns org member list', async () => {
    // member query result
    db._queueResult([
      { userId: 'user-1', role: 'owner', name: 'Alice', email: 'alice@test.com' },
    ]);
    // user_concept_states query (inArray)
    db._queueResult([
      { userId: 'user-1', conceptId: 'react', mu: 2.0, sigma: 0.5, assessmentCount: 5 },
    ]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/members');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].mastery).toBeDefined();
    expect(body[0].mastery.totalAssessed).toBeDefined();
  });

  // --- GET /members/:userId ---

  it('GET /members/:userId returns member knowledge graph', async () => {
    // membership check
    db._queueResult([{ userId: 'user-2', organizationId: 'org-1', role: 'member' }]);
    // concept states
    db._queueResult([
      { conceptId: 'react', mu: 1.5, sigma: 0.5, assessmentCount: 3, lastAssessed: new Date().toISOString() },
    ]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/members/user-2');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.userId).toBe('user-2');
    expect(body.concepts).toBeDefined();
    expect(body.concepts).toHaveLength(1);
  });

  it('GET /members/:userId returns 403 for non-org member', async () => {
    // membership check returns user in different org
    db._queueResult([{ userId: 'user-3', organizationId: 'other-org', role: 'member' }]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/members/user-3');
    expect(res.status).toBe(403);
  });

  // --- GET /rankings ---

  it('GET /rankings returns mastery leaderboard', async () => {
    // members
    db._queueResult([
      { userId: 'user-1', role: 'owner', name: 'Alice', email: 'alice@test.com' },
      { userId: 'user-2', role: 'member', name: 'Bob', email: 'bob@test.com' },
    ]);
    // states
    db._queueResult([
      { userId: 'user-1', conceptId: 'react', mu: 2.0, sigma: 0.5, assessmentCount: 5 },
      { userId: 'user-2', conceptId: 'react', mu: 1.0, sigma: 0.8, assessmentCount: 2 },
    ]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/rankings');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty('mastered');
    expect(body[0]).toHaveProperty('avgMastery');
  });

  // --- GET /analytics ---

  it('GET /analytics returns aggregate analytics', async () => {
    // members
    db._queueResult([{ userId: 'user-1' }, { userId: 'user-2' }]);
    // total assessments
    db._queueExecute({ rows: [{ count: 42 }] });
    // concept coverage
    db._queueExecute({
      rows: [{ concept_id: 'react', assessed_by: 2, avg_mu: 1.5 }],
    });

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/analytics');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.memberCount).toBe(2);
    expect(body.totalAssessments).toBe(42);
    expect(body.conceptCoverage).toBeDefined();
  });

  it('GET /analytics returns empty when no members', async () => {
    db._queueResult([]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/analytics');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.memberCount).toBe(0);
  });

  // --- GET /settings ---

  it('GET /settings returns defaults when no metadata', async () => {
    db._queueResult([{ metadata: null }]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/settings');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rateLimits).toBeDefined();
    expect(body.rateLimits.probeEvalsPerConcept).toBe(1);
    expect(body.integritySettings.dampeningThreshold).toBe(0.5);
  });

  it('GET /settings returns stored settings', async () => {
    db._queueResult([{
      metadata: JSON.stringify({
        rateLimits: { probeEvalsPerConcept: 5 },
        integritySettings: { dampeningThreshold: 0.3 },
      }),
    }]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/settings');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rateLimits.probeEvalsPerConcept).toBe(5);
    expect(body.integritySettings.dampeningThreshold).toBe(0.3);
  });

  // --- GET /integrity ---

  it('GET /integrity returns aggregate integrity stats', async () => {
    db._queueResult([{ userId: 'user-1' }]); // members
    db._queueResult([{ metadata: null }]); // org metadata
    db._queueExecute({
      rows: [{ total: 10, avg_score: 0.85, flagged_count: 1, flagged_members: 1 }],
    });

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/integrity');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.totalWithIntegrity).toBe(10);
    expect(body.flaggedCount).toBe(1);
  });

  // --- DELETE /annotations ---

  it('DELETE /annotations/:id deletes own annotation', async () => {
    db._queueResult([{
      id: 1,
      authorId: 'user-1',
      eventId: 1,
      text: 'test',
    }]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/annotations/1', { method: 'DELETE' });
    expect(res.status).toBe(204);
  });

  it('DELETE /annotations/:id returns 403 for other user', async () => {
    db._queueResult([{
      id: 1,
      authorId: 'user-other',
      eventId: 1,
      text: 'test',
    }]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/annotations/1', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('DELETE /annotations/:id returns 404 for missing', async () => {
    db._queueResult([]);

    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/annotations/999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('DELETE /annotations/:id returns 400 for invalid ID', async () => {
    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = createTestApp(db);
    app.route('/', orgRoutes);

    const res = await app.request('/annotations/abc', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  // --- Auth ---

  it('returns 401 for unauthenticated requests', async () => {
    const { orgRoutes } = await import('../../../src/api/routes/org.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db as any);
      c.set('auth', {} as any);
      c.set('user', null);
      c.set('session', null);
      await next();
    });
    app.route('/', orgRoutes);

    const res = await app.request('/members');
    expect(res.status).toBe(401);
  });
});
