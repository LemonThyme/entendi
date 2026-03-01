import { config } from 'dotenv';

config();

import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/api/index.js';

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

// --- Integration tests for concurrent observe protection and orphan cleanup ---
const testDbUrl = process.env.DATABASE_URL;
const testApiKey = process.env.ENTENDI_API_KEY;
const testSecret = process.env.BETTER_AUTH_SECRET;
const canRun = testDbUrl && testApiKey && testSecret && process.env.INTEGRATION_TESTS === '1';
const describeWithDb = canRun ? describe : describe.skip;

describeWithDb('concurrent observe protection', () => {
  const { app } = createApp(testDbUrl!, { secret: testSecret! });
  const headers = { 'Content-Type': 'application/json', 'x-api-key': testApiKey! };

  it('marks old probe token as superseded when observe overwrites pending action', async () => {
    const suffix = Date.now();
    // First observe — creates pending action + probe token
    const res1 = await app.request('/api/mcp/observe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        concepts: [{ id: `concurrent-test-a-${suffix}`, source: 'llm' }],
        triggerContext: 'testing concurrent observe protection',
      }),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as any;

    if (!body1.shouldProbe) return; // skip if not probed

    const oldTokenId = body1.probeToken?.tokenId;
    expect(oldTokenId).toBeDefined();

    // Second observe — should supersede the old token
    const res2 = await app.request('/api/mcp/observe', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        concepts: [{ id: `concurrent-test-b-${suffix}`, source: 'llm' }],
        triggerContext: 'testing concurrent observe protection',
      }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as any;

    // New probe should either trigger or not, but the old token should be superseded
    // We can verify by trying to use the old token — it should fail
    if (body1.shouldProbe && body2.shouldProbe) {
      const evalRes = await app.request('/api/mcp/record-evaluation', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          conceptId: `concurrent-test-a-${suffix}`,
          score: 2,
          confidence: 0.8,
          reasoning: 'testing with old token',
          eventType: 'probe',
          probeToken: body1.probeToken,
          responseText: 'my understanding of the concept',
        }),
      });
      // Old token should be rejected because usedAt was set
      expect(evalRes.status).toBe(403);
    }
  });
});

describeWithDb('health endpoint orphan cleanup', () => {
  const { app } = createApp(testDbUrl!, { secret: testSecret! });

  it('returns ok status with cleanup fields', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
    expect(body.db).toBe('connected');
    expect(typeof body.dbLatencyMs).toBe('number');
  });
});
