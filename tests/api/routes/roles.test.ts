import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/api/index.js';

/**
 * Mock DB builder for roles route tests.
 *
 * We track calls to select/insert/update/delete and return queued results.
 * Each chainable method returns a fresh link so queries don't interfere.
 */
function createDbMock(resultQueues: { select?: any[][]; insert?: any[][]; update?: any[][]; delete?: any[][] } = {}) {
  const selectQueue = [...(resultQueues.select ?? [])];
  const insertQueue = [...(resultQueues.insert ?? [])];
  const updateQueue = [...(resultQueues.update ?? [])];
  const deleteQueue = [...(resultQueues.delete ?? [])];

  const makeLink = (queue: any[][]): any => {
    const link: any = {
      from: vi.fn(() => makeLink(queue)),
      where: vi.fn(() => makeLink(queue)),
      set: vi.fn(() => makeLink(queue)),
      values: vi.fn(() => makeLink(queue)),
      returning: vi.fn(() => makeLink(queue)),
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
    insert: vi.fn(() => makeLink(insertQueue)),
    update: vi.fn(() => makeLink(updateQueue)),
    delete: vi.fn(() => makeLink(deleteQueue)),
  };
}

function createApp(db: any, opts: { userId?: string; orgId?: string | null; role?: string } = {}) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('db', db as any);
    c.set('auth', {} as any);
    c.set('user', { id: opts.userId ?? 'user-1', name: 'Test', email: 'test@test.com' });
    c.set('session', {
      id: 'sess-1',
      userId: opts.userId ?? 'user-1',
      activeOrganizationId: 'orgId' in opts ? opts.orgId : 'org-1',
    });
    await next();
  });
  return app;
}

async function mountRoles(app: Hono<Env>) {
  const { roleRoutes } = await import('../../../src/api/routes/roles.js');
  app.route('/roles', roleRoutes);
  return app;
}

describe('Roles CRUD API', () => {
  // --- POST / (create role) ---

  it('POST /roles creates role with permissions (201)', async () => {
    const role = { id: 'role-1', orgId: 'org-1', name: 'Teacher', description: 'Teaching role', isDefault: false, createdAt: new Date() };
    const db = createDbMock({
      select: [
        // requireOwnerOrAdmin: member lookup
        [{ role: 'owner' }],
        // duplicate name check
        [],
        // fetch created role
        [role],
        // fetch permissions
        [{ permission: 'codebases.create' }, { permission: 'syllabi.view_progress' }],
      ],
      insert: [
        // insert role
        [],
        // insert permissions
        [],
      ],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Teacher',
        description: 'Teaching role',
        permissions: ['codebases.create', 'syllabi.view_progress'],
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.name).toBe('Teacher');
    expect(body.permissions).toEqual(['codebases.create', 'syllabi.view_progress']);
  });

  it('POST /roles rejects duplicate name (409)', async () => {
    const db = createDbMock({
      select: [
        // requireOwnerOrAdmin: member lookup
        [{ role: 'admin' }],
        // duplicate name check — found
        [{ id: 'existing-role' }],
      ],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Teacher', permissions: ['codebases.create'] }),
    });

    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toMatch(/already exists/);
  });

  it('POST /roles rejects non-admin member (403)', async () => {
    const db = createDbMock({
      select: [
        // requireOwnerOrAdmin: member lookup — regular member
        [{ role: 'member' }],
      ],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'NewRole', permissions: ['codebases.create'] }),
    });

    expect(res.status).toBe(403);
  });

  it('POST /roles rejects invalid permissions (400)', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'owner' }],
      ],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'BadRole', permissions: ['not.a.real.permission'] }),
    });

    expect(res.status).toBe(400);
  });

  // --- GET / (list roles) ---

  it('GET /roles lists roles for active org', async () => {
    const roles = [
      { id: 'role-1', orgId: 'org-1', name: 'Admin', description: null, isDefault: true, createdAt: new Date() },
      { id: 'role-2', orgId: 'org-1', name: 'Teacher', description: 'Teaching', isDefault: false, createdAt: new Date() },
    ];
    const db = createDbMock({
      select: [
        // list roles
        roles,
        // permissions for role-1
        [{ permission: 'codebases.create' }],
        // permissions for role-2
        [{ permission: 'syllabi.edit' }],
      ],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles');
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('Admin');
    expect(body[0].permissions).toEqual(['codebases.create']);
    expect(body[1].name).toBe('Teacher');
    expect(body[1].permissions).toEqual(['syllabi.edit']);
  });

  it('GET /roles returns 400 with no active org', async () => {
    const db = createDbMock();
    const app = createApp(db, { orgId: null });
    await mountRoles(app);

    const res = await app.request('/roles');
    expect(res.status).toBe(400);
  });

  // --- PUT /:id (update role) ---

  it('PUT /roles/:id updates role name and permissions', async () => {
    const role = { id: 'role-1', orgId: 'org-1', name: 'Teacher', description: 'Teaching', isDefault: false, createdAt: new Date() };
    const updatedRole = { ...role, name: 'Lead Teacher' };
    const db = createDbMock({
      select: [
        // requireOwnerOrAdmin: member lookup
        [{ role: 'owner' }],
        // find role by id + orgId
        [role],
        // duplicate name check for new name
        [],
        // fetch updated role
        [updatedRole],
        // fetch permissions
        [{ permission: 'codebases.edit' }, { permission: 'members.invite' }],
      ],
      update: [[]],
      delete: [[]],
      insert: [[]],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles/role-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lead Teacher', permissions: ['codebases.edit', 'members.invite'] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('Lead Teacher');
    expect(body.permissions).toEqual(['codebases.edit', 'members.invite']);
  });

  it('PUT /roles/:id rejects non-admin member (403)', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }],
      ],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles/role-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacker' }),
    });

    expect(res.status).toBe(403);
  });

  // --- DELETE /:id (delete role) ---

  it('DELETE /roles/:id deletes role', async () => {
    const role = { id: 'role-1', orgId: 'org-1', name: 'Teacher', description: null, isDefault: false, createdAt: new Date() };
    const db = createDbMock({
      select: [
        // requireOwnerOrAdmin: member lookup
        [{ role: 'admin' }],
        // find role
        [role],
      ],
      delete: [[]],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles/role-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });

  it('DELETE /roles/:id rejects built-in roles (400)', async () => {
    const role = { id: 'role-builtin', orgId: 'org-1', name: 'Admin', description: null, isDefault: true, createdAt: new Date() };
    const db = createDbMock({
      select: [
        // requireOwnerOrAdmin: member lookup
        [{ role: 'owner' }],
        // find role — built-in
        [role],
      ],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles/role-builtin', { method: 'DELETE' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/built-in/i);
  });

  it('DELETE /roles/:id rejects non-admin member (403)', async () => {
    const db = createDbMock({
      select: [
        [{ role: 'member' }],
      ],
    });

    const app = createApp(db);
    await mountRoles(app);

    const res = await app.request('/roles/role-1', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });
});
