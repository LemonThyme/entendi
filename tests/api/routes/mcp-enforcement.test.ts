import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minimal chainable DB mock for the pending-action endpoint.
 * Supports: select().from().where() and select().from().innerJoin().where()
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

describe('GET /pending-action enforcement', () => {
  let db: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
  });

  it('returns enforcement field defaulting to "remind" when user has no org', async () => {
    // pending action query → no action
    db._queueResult([]);
    // enforcement resolver: member+org join → no memberships
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/pending-action');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pending).toBeNull();
    expect(body.enforcement).toBe('remind');
  });

  it('returns enforcement from org metadata', async () => {
    // pending action query → no action
    db._queueResult([]);
    // enforcement resolver → org with enforce
    db._queueResult([{ metadata: JSON.stringify({ enforcementLevel: 'enforce' }) }]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/pending-action');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.enforcement).toBe('enforce');
  });

  it('returns enforcement "off" when org sets it', async () => {
    // pending action query → no action
    db._queueResult([]);
    // enforcement resolver → org with off
    db._queueResult([{ metadata: JSON.stringify({ enforcementLevel: 'off' }) }]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/pending-action');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.enforcement).toBe('off');
  });

  it('includes enforcement alongside pending action data', async () => {
    // pending action query → has action
    db._queueResult([{
      userId: 'user-1',
      actionType: 'awaiting_probe_response',
      data: { conceptId: 'react', depth: 1 },
      probeTokenId: null,
      createdAt: new Date(),
    }]);
    // enforcement resolver → remind
    db._queueResult([]);

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/pending-action');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pending).toBeDefined();
    expect(body.pending.type).toBe('awaiting_probe_response');
    expect(body.enforcement).toBe('remind');
  });
});
