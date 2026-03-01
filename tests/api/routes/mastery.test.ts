import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStates = [
  { userId: 'user-1', conceptId: 'react-hooks', mu: 1.5, sigma: 0.5, assessmentCount: 3, lastAssessed: new Date().toISOString() },
  { userId: 'user-1', conceptId: 'typescript', mu: 0.8, sigma: 1.0, assessmentCount: 1, lastAssessed: new Date().toISOString() },
];

const mockEvents = [
  { id: 1, userId: 'user-1', conceptId: 'react-hooks', eventType: 'probe', rubricScore: 2, createdAt: new Date().toISOString() },
];

// Mock drizzle chain
const mockWhere = vi.fn();
const mockOrderBy = vi.fn().mockReturnThis();
const mockLimit = vi.fn();
const mockFrom = vi.fn();
const mockExecute = vi.fn();
const mockSelect = vi.fn();

const mockDb = {
  select: mockSelect,
  execute: mockExecute,
};

function resetMocks() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockLimit.mockResolvedValue([]);
  mockWhere.mockResolvedValue([]);
}

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', mockDb as any);
    c.set('auth', {} as any);
    c.set('user', { id: 'user-1', name: 'Test User', email: 'test@test.com' });
    c.set('session', { id: 'sess-1', userId: 'user-1' });
    await next();
  });
  return app;
}

describe('mastery routes (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('GET / returns mastery states for authenticated user', async () => {
    mockWhere.mockResolvedValueOnce(mockStates);

    const { masteryRoutes } = await import('../../../src/api/routes/mastery.js');
    const app = createTestApp();
    app.route('/', masteryRoutes);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(2);
    expect(body[0].conceptId).toBe('react-hooks');
  });

  it('GET /:conceptId returns state for specific concept', async () => {
    mockWhere.mockResolvedValueOnce([mockStates[0]]);

    const { masteryRoutes } = await import('../../../src/api/routes/mastery.js');
    const app = createTestApp();
    app.route('/', masteryRoutes);

    const res = await app.request('/react-hooks');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.conceptId).toBe('react-hooks');
    expect(body.mu).toBe(1.5);
  });

  it('GET /:conceptId returns defaults when no state exists', async () => {
    mockWhere.mockResolvedValueOnce([]);

    const { masteryRoutes } = await import('../../../src/api/routes/mastery.js');
    const app = createTestApp();
    app.route('/', masteryRoutes);

    const res = await app.request('/unknown-concept');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.mu).toBe(0);
    expect(body.sigma).toBe(1.5);
    expect(body.assessmentCount).toBe(0);
  });

  it('GET /:conceptId/history returns assessment events', async () => {
    // This route chains: select → from → where → orderBy → limit
    const chainLimit = vi.fn().mockResolvedValueOnce(mockEvents);
    const chainOrderBy = vi.fn().mockReturnValue({ limit: chainLimit });
    mockWhere.mockReturnValueOnce({ orderBy: chainOrderBy });

    const { masteryRoutes } = await import('../../../src/api/routes/mastery.js');
    const app = createTestApp();
    app.route('/', masteryRoutes);

    const res = await app.request('/react-hooks/history');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].eventType).toBe('probe');
  });

  it('GET /zpd-frontier returns frontier concepts', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'redis', domain: 'backend', specificity: 3, mu: 0, sigma: 1.5 },
      ],
    });

    const { masteryRoutes } = await import('../../../src/api/routes/mastery.js');
    const app = createTestApp();
    app.route('/', masteryRoutes);

    const res = await app.request('/zpd-frontier');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.frontier).toBeDefined();
    expect(body.frontier).toHaveLength(1);
    expect(body.frontier[0].id).toBe('redis');
  });

  it('GET /zpd-frontier accepts threshold query parameter', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const { masteryRoutes } = await import('../../../src/api/routes/mastery.js');
    const app = createTestApp();
    app.route('/', masteryRoutes);

    const res = await app.request('/zpd-frontier?threshold=0.9');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.frontier).toBeDefined();
  });

  it('GET / returns 401 when user is not authenticated', async () => {
    const { masteryRoutes } = await import('../../../src/api/routes/mastery.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', mockDb as any);
      c.set('auth', {} as any);
      c.set('user', null);
      c.set('session', null);
      await next();
    });
    app.route('/', masteryRoutes);

    const res = await app.request('/');
    expect(res.status).toBe(401);
  });
});
