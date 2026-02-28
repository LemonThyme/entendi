import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockEvents = [
  { id: 1, userId: 'user-1', conceptId: 'react-hooks', eventType: 'probe', rubricScore: 2, createdAt: new Date().toISOString() },
  { id: 2, userId: 'user-1', conceptId: 'typescript', eventType: 'probe', rubricScore: 3, createdAt: new Date().toISOString() },
];

const mockLimit = vi.fn();
const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

const mockDb = { select: mockSelect };

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

describe('history routes (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue([]);
  });

  it('GET / returns assessment event log', async () => {
    mockLimit.mockResolvedValueOnce(mockEvents);

    const { historyRoutes } = await import('../../../src/api/routes/history.js');
    const app = createTestApp();
    app.route('/', historyRoutes);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(2);
    expect(body[0].conceptId).toBe('react-hooks');
  });

  it('GET / respects limit query parameter', async () => {
    mockLimit.mockResolvedValueOnce([mockEvents[0]]);

    const { historyRoutes } = await import('../../../src/api/routes/history.js');
    const app = createTestApp();
    app.route('/', historyRoutes);

    const res = await app.request('/?limit=1');
    expect(res.status).toBe(200);
  });

  it('GET /:conceptId returns per-concept history', async () => {
    mockLimit.mockResolvedValueOnce([mockEvents[0]]);

    const { historyRoutes } = await import('../../../src/api/routes/history.js');
    const app = createTestApp();
    app.route('/', historyRoutes);

    const res = await app.request('/react-hooks');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].conceptId).toBe('react-hooks');
  });

  it('GET / returns 401 when not authenticated', async () => {
    const { historyRoutes } = await import('../../../src/api/routes/history.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', mockDb as any);
      c.set('auth', {} as any);
      c.set('user', null);
      c.set('session', null);
      await next();
    });
    app.route('/', historyRoutes);

    const res = await app.request('/');
    expect(res.status).toBe(401);
  });

  it('GET /:conceptId returns empty array when no events', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const { historyRoutes } = await import('../../../src/api/routes/history.js');
    const app = createTestApp();
    app.route('/', historyRoutes);

    const res = await app.request('/nonexistent');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toEqual([]);
  });
});
