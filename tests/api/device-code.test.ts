import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock crypto.randomUUID for deterministic IDs
vi.stubGlobal('crypto', {
  ...crypto,
  randomUUID: vi.fn(() => 'test-uuid-1234'),
});

// Mock drizzle operations
const mockInsert = vi.fn().mockReturnThis();
const mockValues = vi.fn().mockReturnThis();
const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockResolvedValue([]);
const mockDelete = vi.fn().mockReturnThis();
const mockUpdate = vi.fn().mockReturnThis();
const mockSet = vi.fn().mockReturnThis();

const mockDb = {
  insert: mockInsert,
  select: mockSelect,
  delete: mockDelete,
  update: mockUpdate,
};
mockInsert.mockReturnValue({ values: mockValues });
mockSelect.mockReturnValue({ from: mockFrom });
mockFrom.mockReturnValue({ where: mockWhere });
mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

describe('device code API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    mockValues.mockResolvedValue([]);
  });

  it('POST / creates a device code with expected format', async () => {
    // Import after mocks are set up
    const { deviceCodeRoutes } = await import('../../src/api/routes/device-code.js');

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', mockDb as any);
      c.set('auth', { api: { createApiKey: vi.fn() } } as any);
      c.set('user', null);
      c.set('session', null);
      await next();
    });
    app.route('/', deviceCodeRoutes);

    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBeDefined();
    expect(body.code).toHaveLength(8);
    expect(body.verifyUrl).toContain(body.code);
    expect(body.expiresAt).toBeDefined();
  });

  it('GET /:code returns pending for pending code', async () => {
    const now = new Date();
    const expires = new Date(now.getTime() + 10 * 60 * 1000);
    mockWhere.mockResolvedValueOnce([{
      code: 'ABCD1234',
      status: 'pending',
      userId: null,
      apiKey: null,
      expiresAt: expires,
      createdAt: now,
    }]);

    const { deviceCodeRoutes } = await import('../../src/api/routes/device-code.js');

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', mockDb as any);
      c.set('auth', { api: { createApiKey: vi.fn() } } as any);
      c.set('user', null);
      c.set('session', null);
      await next();
    });
    app.route('/', deviceCodeRoutes);

    const res = await app.request('/ABCD1234');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('pending');
  });

  it('GET /:code returns expired for expired code', async () => {
    const expires = new Date(Date.now() - 1000); // expired 1s ago
    mockWhere.mockResolvedValueOnce([{
      code: 'ABCD1234',
      status: 'pending',
      userId: null,
      apiKey: null,
      expiresAt: expires,
      createdAt: new Date(),
    }]);

    const { deviceCodeRoutes } = await import('../../src/api/routes/device-code.js');

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', mockDb as any);
      c.set('auth', { api: { createApiKey: vi.fn() } } as any);
      c.set('user', null);
      c.set('session', null);
      await next();
    });
    app.route('/', deviceCodeRoutes);

    const res = await app.request('/ABCD1234');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('expired');
  });

  it('GET /:code returns 404 for unknown code', async () => {
    mockWhere.mockResolvedValueOnce([]);

    const { deviceCodeRoutes } = await import('../../src/api/routes/device-code.js');

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', mockDb as any);
      c.set('auth', { api: { createApiKey: vi.fn() } } as any);
      c.set('user', null);
      c.set('session', null);
      await next();
    });
    app.route('/', deviceCodeRoutes);

    const res = await app.request('/NOTEXIST');
    expect(res.status).toBe(404);
  });
});
