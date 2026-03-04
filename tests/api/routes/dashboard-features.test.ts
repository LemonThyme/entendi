import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/api/index.js';

function createDbMock(resultQueues: { select?: any[][] } = {}) {
  const selectQueue = [...(resultQueues.select ?? [])];

  const makeLink = (queue: any[][]): any => {
    const link: any = {
      from: vi.fn(() => makeLink(queue)),
      where: vi.fn(() => makeLink(queue)),
      limit: vi.fn(() => Promise.resolve(queue.length > 0 ? queue.shift() : [])),
      // biome-ignore lint/suspicious/noThenProperty: simulates Drizzle thenable query
      then(resolve: any, reject?: any) {
        return Promise.resolve(queue.length > 0 ? queue.shift() : []).then(resolve, reject);
      },
    };
    return link;
  };

  return {
    select: vi.fn(() => makeLink(selectQueue)),
    insert: vi.fn(() => makeLink(selectQueue)),
    update: vi.fn(() => makeLink(selectQueue)),
    delete: vi.fn(() => makeLink(selectQueue)),
  };
}

function createApp(db: any, opts: { userId?: string; orgId?: string | null; noUser?: boolean } = {}) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('db', db as any);
    c.set('auth', {} as any);
    if (!opts.noUser) {
      c.set('user', { id: opts.userId ?? 'user-1', name: 'Test', email: 'test@test.com' });
    }
    c.set('session', {
      id: 'sess-1',
      userId: opts.userId ?? 'user-1',
      activeOrganizationId: 'orgId' in opts ? opts.orgId : 'org-1',
    });
    await next();
  });
  return app;
}

async function mountDashboard(app: Hono<Env>) {
  const { dashboardRoutes } = await import('../../../src/api/routes/dashboard.js');
  app.route('/', dashboardRoutes);
  return app;
}

describe('GET /api/dashboard/features', () => {
  it('returns 401 if not authenticated', async () => {
    const db = createDbMock();
    const app = createApp(db, { noUser: true });
    await mountDashboard(app);

    const res = await app.request('/api/dashboard/features');
    expect(res.status).toBe(401);
  });

  it('returns both false when no org', async () => {
    const db = createDbMock();
    const app = createApp(db, { orgId: null });
    await mountDashboard(app);

    const res = await app.request('/api/dashboard/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ codebasesVisible: false, syllabiVisible: false });
  });

  it('returns both visible for owner (has all permissions)', async () => {
    const db = createDbMock({
      select: [
        [{ value: 0 }], // codebases count = 0
        [{ value: 0 }], // syllabi count = 0
        [{ role: 'owner', roleId: null }], // hasPermission for codebases.create
        [{ role: 'owner', roleId: null }], // hasPermission for syllabi.create
      ],
    });
    const app = createApp(db);
    await mountDashboard(app);

    const res = await app.request('/api/dashboard/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ codebasesVisible: true, syllabiVisible: true });
  });

  it('returns visible when org has items (regardless of permissions)', async () => {
    const db = createDbMock({
      select: [
        [{ value: 3 }], // codebases count = 3
        [{ value: 1 }], // syllabi count = 1
        // No permission queries needed since items exist
      ],
    });
    const app = createApp(db);
    await mountDashboard(app);

    const res = await app.request('/api/dashboard/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ codebasesVisible: true, syllabiVisible: true });
  });

  it('returns false for member without create permissions and no items', async () => {
    const db = createDbMock({
      select: [
        [{ value: 0 }], // codebases count = 0
        [{ value: 0 }], // syllabi count = 0
        [{ role: 'member', roleId: 'role-1' }], // hasPermission for codebases.create
        [],                                       // no codebases.create permission found
        [{ role: 'member', roleId: 'role-1' }], // hasPermission for syllabi.create
        [],                                       // no syllabi.create permission found
      ],
    });
    const app = createApp(db);
    await mountDashboard(app);

    const res = await app.request('/api/dashboard/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ codebasesVisible: false, syllabiVisible: false });
  });

  it('returns mixed visibility based on items and permissions', async () => {
    const db = createDbMock({
      select: [
        [{ value: 2 }], // codebases count = 2 (has items)
        [{ value: 0 }], // syllabi count = 0
        // codebases permission not checked (items exist)
        [{ role: 'member', roleId: null }], // hasPermission for syllabi.create — no roleId
      ],
    });
    const app = createApp(db);
    await mountDashboard(app);

    const res = await app.request('/api/dashboard/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ codebasesVisible: true, syllabiVisible: false });
  });
});
