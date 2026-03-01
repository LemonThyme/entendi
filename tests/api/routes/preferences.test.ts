import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWhere = vi.fn();
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
const mockValues = vi.fn();
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
const mockOnConflict = vi.fn();

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
};

function resetMocks() {
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflict });
  mockOnConflict.mockResolvedValue([]);
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

describe('preferences routes (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('GET / returns defaults when no preferences exist', async () => {
    mockWhere.mockResolvedValueOnce([]);

    const { preferencesRoutes } = await import('../../../src/api/routes/preferences.js');
    const app = createTestApp();
    app.route('/', preferencesRoutes);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.summaryFrequency).toBe('weekly');
    expect(body.transactionalEnabled).toBe(true);
  });

  it('GET / returns stored preferences', async () => {
    mockWhere.mockResolvedValueOnce([{
      userId: 'user-1',
      summaryFrequency: 'monthly',
      transactionalEnabled: false,
    }]);

    const { preferencesRoutes } = await import('../../../src/api/routes/preferences.js');
    const app = createTestApp();
    app.route('/', preferencesRoutes);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.summaryFrequency).toBe('monthly');
    expect(body.transactionalEnabled).toBe(false);
  });

  it('PUT / updates preferences', async () => {
    // After upsert, the select returns updated prefs
    mockWhere.mockResolvedValueOnce([{
      userId: 'user-1',
      summaryFrequency: 'biweekly',
      transactionalEnabled: true,
    }]);

    const { preferencesRoutes } = await import('../../../src/api/routes/preferences.js');
    const app = createTestApp();
    app.route('/', preferencesRoutes);

    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summaryFrequency: 'biweekly' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.summaryFrequency).toBe('biweekly');
  });

  it('PUT / rejects invalid summaryFrequency', async () => {
    const { preferencesRoutes } = await import('../../../src/api/routes/preferences.js');
    const app = createTestApp();
    app.route('/', preferencesRoutes);

    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summaryFrequency: 'daily' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET / returns 401 when not authenticated', async () => {
    const { preferencesRoutes } = await import('../../../src/api/routes/preferences.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', mockDb as any);
      c.set('auth', {} as any);
      c.set('user', null);
      c.set('session', null);
      await next();
    });
    app.route('/', preferencesRoutes);

    const res = await app.request('/');
    expect(res.status).toBe(401);
  });
});
