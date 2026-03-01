import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minimal chainable DB mock for dismiss endpoint testing.
 */
function createDbMock() {
  let resultQueue: any[] = [];

  function nextResult() {
    if (resultQueue.length > 0) return resultQueue.shift();
    return [];
  }

  function makeLink(): any {
    let resolved = false;
    const link: any = {
      from: vi.fn(() => makeLink()),
      where: vi.fn(() => makeLink()),
      innerJoin: vi.fn(() => makeLink()),
      values: vi.fn(() => makeLink()),
      onConflictDoUpdate: vi.fn(() => makeLink()),
      set: vi.fn(() => makeLink()),
      // biome-ignore lint/suspicious/noThenProperty: mock needs thenable interface for Drizzle query chain
      then(resolve: any, reject?: any) {
        if (!resolved) { resolved = true; return Promise.resolve(nextResult()).then(resolve, reject); }
        return Promise.resolve(undefined).then(resolve, reject);
      },
    };
    return link;
  }

  const db = {
    select: vi.fn(() => makeLink()),
    delete: vi.fn(() => makeLink()),
    insert: vi.fn(() => makeLink()),
    update: vi.fn(() => makeLink()),
    _queueResult: (result: any) => { resultQueue.push(result); },
    _reset: () => { resultQueue = []; },
  };

  return db;
}

function createTestApp(db: any, opts: { userId?: string } = {}) {
  const userId = opts.userId ?? 'user-1';
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db as any);
    c.set('auth', {} as any);
    c.set('user', { id: userId, name: 'Test User', email: 'test@test.com' });
    c.set('session', { id: 'sess-1', userId, activeOrganizationId: null });
    await next();
  });
  return app;
}

describe('POST /dismiss enforcement-aware policy', () => {
  let db: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
  });

  it('rejects topic_change dismiss when enforcement is enforce', async () => {
    // enforcement resolver runs FIRST for topic_change → enforce
    db._queueResult([{ metadata: JSON.stringify({ enforcementLevel: 'enforce' }) }]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'topic_change' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rejected).toBe(true);
    expect(body.reason).toBeDefined();
    // Pending action should NOT have been deleted
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('allows topic_change dismiss when enforcement is remind', async () => {
    // enforcement resolver runs FIRST for topic_change → remind (no org memberships)
    db._queueResult([]);
    // pending action query → has action
    db._queueResult([{
      userId: 'user-1',
      actionType: 'awaiting_probe_response',
      data: { conceptId: 'react', depth: 1 },
      probeTokenId: null,
      createdAt: new Date(),
    }]);
    // insert dismissal event → ok
    db._queueResult([]);
    // update probe session → ok
    db._queueResult([]);
    // update tutor sessions → ok
    db._queueResult([]);
    // delete pending action → ok
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'topic_change' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rejected).toBeUndefined();
    expect(body.acknowledged).toBe(true);
    expect(body.dismissalRecorded).toBe(true);
  });

  it('allows topic_change dismiss when enforcement is off', async () => {
    // enforcement resolver runs FIRST for topic_change → off
    db._queueResult([{ metadata: JSON.stringify({ enforcementLevel: 'off' }) }]);
    // pending action query → has action
    db._queueResult([{
      userId: 'user-1',
      actionType: 'awaiting_probe_response',
      data: { conceptId: 'react', depth: 1 },
      probeTokenId: null,
      createdAt: new Date(),
    }]);
    // insert dismissal event → ok
    db._queueResult([]);
    // update probe session → ok
    db._queueResult([]);
    // update tutor sessions → ok
    db._queueResult([]);
    // delete pending action → ok
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'topic_change' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rejected).toBeUndefined();
    expect(body.acknowledged).toBe(true);
  });

  it('allows busy dismiss even when enforcement is enforce', async () => {
    // pending action query → has action
    db._queueResult([{
      userId: 'user-1',
      actionType: 'awaiting_probe_response',
      data: { conceptId: 'react', depth: 1 },
      probeTokenId: null,
      createdAt: new Date(),
    }]);
    // No enforcement check for busy reason — it goes directly to busy branch
    // busy count query → 0 prior
    db._queueResult([{ count: 0 }]);
    // insert dismissal event → ok
    db._queueResult([]);
    // update probe session → ok
    db._queueResult([]);
    // update tutor sessions → ok
    db._queueResult([]);
    // delete pending action → ok
    db._queueResult([]);
    // insert deferred_probe → ok
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'busy' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rejected).toBeUndefined();
    expect(body.acknowledged).toBe(true);
    expect(body.requeued).toBe(true);
  });

  it('allows claimed_expertise dismiss even when enforcement is enforce', async () => {
    // pending action query → has action
    db._queueResult([{
      userId: 'user-1',
      actionType: 'awaiting_probe_response',
      data: { conceptId: 'react', depth: 1 },
      probeTokenId: null,
      createdAt: new Date(),
    }]);
    // No enforcement check for claimed_expertise — goes directly to claimed_expertise branch
    // applyBayesianUpdateDb: concept lookup → found
    db._queueResult([{
      id: 'react',
      userId: 'user-1',
      conceptId: 'react',
      mu: 0,
      sigma: 1.5,
      assessmentCount: 0,
      stability: 1.0,
      difficulty: 5.0,
      lapses: 0,
      lastAssessed: null,
    }]);
    // insert assessment event → ok
    db._queueResult([{ id: 1 }]);
    // update user concept state → ok
    db._queueResult([]);
    // concept edges query (prerequisite propagation) → none
    db._queueResult([]);
    // analytics snapshots → queries
    db._queueResult([]);
    db._queueResult([]);
    // insert dismissal event → ok
    db._queueResult([]);
    // update probe session → ok
    db._queueResult([]);
    // update tutor sessions → ok
    db._queueResult([]);
    // delete pending action → ok
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'claimed_expertise' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.rejected).toBeUndefined();
    expect(body.acknowledged).toBe(true);
    expect(body.autoScored).toBe(true);
  });
});
