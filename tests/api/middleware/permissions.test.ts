import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

describe('requirePermission middleware', () => {
  function createDbMock(memberResult: any[], permResult: any[]) {
    const queue = [memberResult, permResult];
    const makeLink = (): any => {
      let resolved = false;
      const link: any = {
        from: vi.fn(() => makeLink()),
        where: vi.fn(() => makeLink()),
        innerJoin: vi.fn(() => makeLink()),
        limit: vi.fn(() => Promise.resolve(queue.length > 0 ? queue.shift() : [])),
        then(resolve: any, reject?: any) {
          if (!resolved) { resolved = true; return Promise.resolve(queue.length > 0 ? queue.shift() : []).then(resolve, reject); }
          return Promise.resolve(undefined).then(resolve, reject);
        },
      };
      return link;
    };
    return { select: vi.fn(() => makeLink()) };
  }

  function createApp(db: any, opts: { userId?: string; orgId?: string | null } = {}) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db as any);
      c.set('auth', {} as any);
      c.set('user', { id: opts.userId ?? 'user-1', name: 'Test', email: 'test@test.com' });
      c.set('session', { id: 'sess-1', userId: opts.userId ?? 'user-1', activeOrganizationId: 'orgId' in opts ? opts.orgId : 'org-1' });
      await next();
    });
    return app;
  }

  it('allows owner regardless of custom role', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'owner', roleId: null }],
      [],
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('allows admin regardless of custom role', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'admin', roleId: null }],
      [],
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('allows member with matching custom role permission', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'member', roleId: 'role-teacher' }],
      [{ permission: 'codebases.create' }],
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('rejects member without matching permission', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'member', roleId: 'role-viewer' }],
      [{ permission: 'members.view' }],
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('rejects member with no custom role', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'member', roleId: null }],
      [],
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('returns 400 if no active org', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock([], []);
    const app = createApp(db, { orgId: null });
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(400);
  });
});
