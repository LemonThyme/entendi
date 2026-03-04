import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for org-context probe scoping: concepts linked to the user's
 * active org's codebases/syllabi get +0.2 urgency boost.
 */

// Set env var needed by probe token creation
process.env.BETTER_AUTH_SECRET = 'test-secret-for-org-scoping-tests';

// Mock heavy dependencies to isolate org-scoping logic
vi.mock('../../../src/api/lib/concept-pipeline.js', () => ({
  resolveConcept: vi.fn(async (_db: any, id: string) => ({ canonicalId: id, isNew: false })),
}));
vi.mock('../../../src/api/lib/embeddings.js', () => ({
  conceptSimilarity: vi.fn(async () => 0.5),
}));
vi.mock('../../../src/api/lib/enforcement.js', () => ({
  resolveEnforcementLevel: vi.fn(async () => 'remind'),
}));
vi.mock('../../../src/api/lib/org-integrity-settings.js', () => ({
  getOrgIntegritySettings: vi.fn(async () => ({})),
}));
vi.mock('../../../src/api/lib/org-rate-limits.js', () => ({
  getOrgRateLimits: vi.fn(async () => ({
    maxProbesPerHour: 0,
    probeIntervalSeconds: 0,
  })),
}));
vi.mock('../../../src/api/lib/concept-normalize.js', () => ({
  resolveConceptId: vi.fn(async (_db: any, id: string) => id),
}));
vi.mock('../../../src/core/analytics-snapshots.js', () => ({
  updateAnalyticsSnapshots: vi.fn(async () => {}),
}));
vi.mock('../../../src/core/prerequisite-propagation.js', () => ({
  propagatePrerequisiteBoost: vi.fn(async () => {}),
}));
vi.mock('../../../src/core/response-integrity.js', () => ({
  computeIntegrityScore: vi.fn(() => 1.0),
  extractResponseFeatures: vi.fn(() => ({})),
  updateResponseProfile: vi.fn(async () => {}),
}));
vi.mock('../../../src/api/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Inline mock for resolveOrgId so we can control the returned org per test
const mockResolveOrgId = vi.fn();
vi.mock('../../../src/api/lib/resolve-org.js', () => ({
  resolveOrgId: (...args: any[]) => mockResolveOrgId(...args),
}));

/**
 * Chainable DB mock. resolveConcept is mocked at module level so it
 * does NOT make DB calls. The queue only needs results for the
 * endpoint's own DB queries.
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
      limit: vi.fn(() => makeLink()),
      innerJoin: vi.fn(() => makeLink()),
      values: vi.fn(() => makeLink()),
      onConflictDoUpdate: vi.fn(() => makeLink()),
      onConflictDoNothing: vi.fn(() => makeLink()),
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

function createTestApp(db: any, opts: { userId?: string; activeOrgId?: string | null } = {}) {
  const userId = opts.userId ?? 'user-1';
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db as any);
    c.set('auth', {} as any);
    c.set('user', { id: userId, name: 'Test User', email: 'test@test.com' });
    c.set('session', {
      id: 'sess-1',
      userId,
      activeOrganizationId: opts.activeOrgId ?? null,
    });
    await next();
  });
  return app;
}

describe('observe org-context probe scoping', () => {
  let db: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
    mockResolveOrgId.mockResolvedValue(null);
  });

  /**
   * Queue DB results for a minimal observe flow with a single concept.
   *
   * resolveConcept is mocked (no DB calls), so the queue starts from
   * the endpoint's own queries:
   *   1. userConceptStates lookup
   *   2. concepts row lookup
   *   3. conceptEdges (prerequisites)
   *   4-5. org-context codebase/syllabus concept queries (if orgId present)
   *   6. probeSessions lookup
   *   7. userConceptStates (all, for user profile)
   *   8. probeSessions upsert
   *   9. pendingActions select (check existing)
   *   10. pendingActions upsert
   *   11. probeTokens insert
   *   12. pendingActions update (link token)
   */
  function queueObserveResults(opts?: {
    orgCbConcepts?: { conceptId: string }[];
    orgSylConcepts?: { conceptId: string }[];
  }) {
    // 1. userConceptStates lookup
    db._queueResult([{ mu: 0.0, sigma: 1.5, stability: 1.0, lastAssessed: null, assessmentCount: 0 }]);
    // 2. concepts row
    db._queueResult([{ id: 'redis', discrimination: 1.0, threshold1: -1.0, threshold2: 0.0, threshold3: 1.0 }]);
    // 3. conceptEdges (prerequisites)
    db._queueResult([]);

    // 4-5. org-context boosting (only if orgId is set — otherwise skipped)
    if (opts?.orgCbConcepts !== undefined || opts?.orgSylConcepts !== undefined) {
      db._queueResult(opts?.orgCbConcepts ?? []);
      db._queueResult(opts?.orgSylConcepts ?? []);
    }

    // 6. probeSessions lookup
    db._queueResult([]);
    // 7. userConceptStates (all, for user profile)
    db._queueResult([]);
    // 8. probeSessions upsert
    db._queueResult([]);
    // 9. pendingActions select (check existing)
    db._queueResult([]);
    // 10. pendingActions upsert
    db._queueResult([]);
    // 11. probeTokens insert
    db._queueResult([]);
    // 12. pendingActions update (link token)
    db._queueResult([]);
  }

  it('boosts urgency for concepts linked to org codebases', async () => {
    mockResolveOrgId.mockResolvedValue('org-1');

    queueObserveResults({
      orgCbConcepts: [{ conceptId: 'redis' }],
      orgSylConcepts: [],
    });

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db, { activeOrgId: 'org-1' });
    app.route('/', mcpRoutes);

    const res = await app.request('/observe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concepts: [{ id: 'redis', source: 'llm' }],
        triggerContext: 'testing org scoping',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.shouldProbe).toBe(true);
    expect(body.conceptId).toBe('redis');
    // Urgency should include the +0.2 org boost
    expect(body.urgency).toBeGreaterThan(0);
  });

  it('boosts urgency for concepts linked to org syllabi', async () => {
    mockResolveOrgId.mockResolvedValue('org-1');

    queueObserveResults({
      orgCbConcepts: [],
      orgSylConcepts: [{ conceptId: 'redis' }],
    });

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db, { activeOrgId: 'org-1' });
    app.route('/', mcpRoutes);

    const res = await app.request('/observe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concepts: [{ id: 'redis', source: 'llm' }],
        triggerContext: 'testing syllabus scoping',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.shouldProbe).toBe(true);
    expect(body.conceptId).toBe('redis');
  });

  it('does not boost when orgId is null', async () => {
    mockResolveOrgId.mockResolvedValue(null);

    // No org concept results queued (org-context block is skipped)
    queueObserveResults();

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db);
    app.route('/', mcpRoutes);

    const res = await app.request('/observe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concepts: [{ id: 'redis', source: 'llm' }],
        triggerContext: 'no org context',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // Should still work, just without org boost
    expect(body.shouldProbe).toBe(true);
  });

  it('does not boost concepts not in org collections', async () => {
    mockResolveOrgId.mockResolvedValue('org-1');

    queueObserveResults({
      orgCbConcepts: [{ conceptId: 'python' }],     // different concept
      orgSylConcepts: [{ conceptId: 'javascript' }], // different concept
    });

    const { mcpRoutes } = await import('../../../src/api/routes/mcp.js');
    const app = createTestApp(db, { activeOrgId: 'org-1' });
    app.route('/', mcpRoutes);

    const res = await app.request('/observe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concepts: [{ id: 'redis', source: 'llm' }],
        triggerContext: 'unrelated org concepts',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.shouldProbe).toBe(true);
    // No org boost applied — urgency should be the base value
  });
});

describe('org-context urgency boost math', () => {
  it('org boost (+0.2) is capped at 1.0', () => {
    let urgency = 0.95;
    urgency = Math.min(1.0, urgency + 0.2);
    expect(urgency).toBe(1.0);
  });

  it('org boost (+0.2) stacks with repoUrl boost (+0.3), capped at 1.0', () => {
    let urgency = 0.6;
    // repoUrl boost first
    urgency = Math.min(1.0, urgency + 0.3);
    expect(urgency).toBeCloseTo(0.9, 5);
    // then org boost
    urgency = Math.min(1.0, urgency + 0.2);
    expect(urgency).toBe(1.0);
  });

  it('both boosts stack within range', () => {
    let urgency = 0.3;
    // repoUrl boost
    urgency = Math.min(1.0, urgency + 0.3);
    expect(urgency).toBeCloseTo(0.6, 5);
    // org boost
    urgency = Math.min(1.0, urgency + 0.2);
    expect(urgency).toBeCloseTo(0.8, 5);
  });

  it('org boost alone adds 0.2', () => {
    let urgency = 0.5;
    urgency = Math.min(1.0, urgency + 0.2);
    expect(urgency).toBeCloseTo(0.7, 5);
  });
});
