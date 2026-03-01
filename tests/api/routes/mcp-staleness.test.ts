import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minimal chainable DB mock for pending-action and observe endpoints.
 * Supports: select().from().where(), insert().values().onConflictDoUpdate(),
 * update().set().where(), delete().where()
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

  const deleteMock = vi.fn(() => makeLink());
  const insertMock = vi.fn(() => makeLink());
  const updateMock = vi.fn(() => makeLink());

  const db = {
    select: vi.fn(() => makeLink()),
    delete: deleteMock,
    insert: insertMock,
    update: updateMock,
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

describe('GET /pending-action stale auto-expiry', () => {
  let db: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
  });

  it('auto-expires awaiting_probe_response older than 30 minutes', async () => {
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
    // pending action query → stale action
    db._queueResult([{
      userId: 'user-1',
      actionType: 'awaiting_probe_response',
      data: { conceptId: 'react', depth: 1 },
      probeTokenId: null,
      createdAt: thirtyOneMinutesAgo,
    }]);
    // enforcement resolver → remind
    db._queueResult([]);
    // delete pending action → ok
    db._queueResult([]);
    // insert dismissal event → ok
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/pending-action');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pending).toBeNull();
    // Verify delete was called (pending action cleared)
    expect(db.delete).toHaveBeenCalled();
    // Verify dismissal was recorded
    expect(db.insert).toHaveBeenCalled();
  });

  it('auto-expires tutor_offered older than 1 hour', async () => {
    const sixtyOneMinutesAgo = new Date(Date.now() - 61 * 60 * 1000);
    // pending action query → stale tutor_offered
    db._queueResult([{
      userId: 'user-1',
      actionType: 'tutor_offered',
      data: { conceptId: 'typescript', depth: 2 },
      probeTokenId: null,
      createdAt: sixtyOneMinutesAgo,
    }]);
    // enforcement resolver → remind
    db._queueResult([]);
    // delete pending action → ok
    db._queueResult([]);
    // insert dismissal event → ok
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/pending-action');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pending).toBeNull();
    expect(db.delete).toHaveBeenCalled();
  });

  it('does NOT auto-expire tutor_active even if older than 2 hours', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    // pending action query → tutor_active (should NOT expire)
    db._queueResult([{
      userId: 'user-1',
      actionType: 'tutor_active',
      data: { conceptId: 'graphql', depth: 1 },
      probeTokenId: null,
      createdAt: threeHoursAgo,
    }]);
    // enforcement resolver → remind
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/pending-action');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pending).not.toBeNull();
    expect(body.pending.type).toBe('tutor_active');
    // delete should NOT have been called
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('returns fresh awaiting_probe_response normally', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    // pending action query → fresh action
    db._queueResult([{
      userId: 'user-1',
      actionType: 'awaiting_probe_response',
      data: { conceptId: 'docker', depth: 1 },
      probeTokenId: 'tok-1',
      createdAt: fiveMinutesAgo,
    }]);
    // enforcement resolver → remind
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/pending-action');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pending).not.toBeNull();
    expect(body.pending.type).toBe('awaiting_probe_response');
    expect(body.pending.conceptId).toBe('docker');
    expect(db.delete).not.toHaveBeenCalled();
  });
});
