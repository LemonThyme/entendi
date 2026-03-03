import { describe, expect, it, vi } from 'vitest';

describe('ensureBuiltInRoles', () => {
  function createDbMock(existingRoles: any[] = []) {
    const insertedRoles: any[] = [];
    const insertedPerms: any[] = [];

    const makeSelectChain = (result: any[]): any => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(() => Promise.resolve(result)),
    });

    const makeInsertChain = (target: any[]): any => ({
      values: vi.fn((rows: any[]) => {
        target.push(...rows);
        return Promise.resolve();
      }),
    });

    const db: any = {
      select: vi.fn(() => makeSelectChain(existingRoles)),
      insert: vi.fn((table: any) => {
        // Distinguish between orgRoles and orgRolePermissions inserts
        // First insert call = roles, second = permissions
        if (insertedRoles.length === 0 || (insertedRoles.length > 0 && insertedPerms.length > 0)) {
          return makeInsertChain(insertedRoles);
        }
        return makeInsertChain(insertedPerms);
      }),
    };

    // Track insert order
    let insertCallCount = 0;
    db.insert = vi.fn(() => {
      insertCallCount++;
      if (insertCallCount === 1) return makeInsertChain(insertedRoles);
      return makeInsertChain(insertedPerms);
    });

    return { db, insertedRoles, insertedPerms };
  }

  it('creates Admin and Member roles with correct permissions', async () => {
    const { ensureBuiltInRoles } = await import('../../../src/api/lib/auth.js');
    const { db, insertedRoles, insertedPerms } = createDbMock([]);

    await ensureBuiltInRoles(db, 'org-1');

    expect(insertedRoles).toHaveLength(2);
    const admin = insertedRoles.find((r: any) => r.name === 'Admin');
    const member = insertedRoles.find((r: any) => r.name === 'Member');
    expect(admin).toBeDefined();
    expect(member).toBeDefined();
    expect(admin.orgId).toBe('org-1');
    expect(member.orgId).toBe('org-1');
    expect(admin.isDefault).toBe(true);
    expect(member.isDefault).toBe(true);

    // Admin permissions
    const adminPerms = insertedPerms.filter((p: any) => p.roleId === admin.id);
    const memberPerms = insertedPerms.filter((p: any) => p.roleId === member.id);

    expect(adminPerms.map((p: any) => p.permission)).toEqual(expect.arrayContaining([
      'codebases.create', 'codebases.edit', 'codebases.delete', 'codebases.view_progress',
      'syllabi.create', 'syllabi.edit', 'syllabi.delete', 'syllabi.view_progress',
      'members.invite', 'members.manage_roles', 'members.view',
      'org.settings',
    ]));
    expect(adminPerms).toHaveLength(12);

    // Admin should NOT have org.billing
    expect(adminPerms.map((p: any) => p.permission)).not.toContain('org.billing');

    // Member permissions
    expect(memberPerms.map((p: any) => p.permission)).toEqual(['members.view']);
    expect(memberPerms).toHaveLength(1);
  });

  it('is idempotent — skips if roles already exist', async () => {
    const { ensureBuiltInRoles } = await import('../../../src/api/lib/auth.js');
    const { db, insertedRoles, insertedPerms } = createDbMock([{ id: 'existing-role' }]);

    await ensureBuiltInRoles(db, 'org-1');

    expect(db.insert).not.toHaveBeenCalled();
    expect(insertedRoles).toHaveLength(0);
    expect(insertedPerms).toHaveLength(0);
  });
});
