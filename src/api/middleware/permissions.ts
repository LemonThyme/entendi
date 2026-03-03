import { and, eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { member, orgRolePermissions } from '../db/schema.js';
import type { Env } from '../index.js';
import { resolveOrgId } from '../lib/resolve-org.js';

export function requirePermission(permission: string) {
  return async (c: Context<Env>, next: Next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const orgId = await resolveOrgId(c);
    if (!orgId) return c.json({ error: 'No active organization' }, 400);

    const db = c.get('db');
    const [membership] = await db.select({
      role: member.role,
      roleId: member.roleId,
    }).from(member).where(
      and(eq(member.userId, user.id), eq(member.organizationId, orgId))
    ).limit(1);

    if (!membership) return c.json({ error: 'Not a member of this organization' }, 403);

    // Owner and admin bypass custom role checks
    if (membership.role === 'owner' || membership.role === 'admin') {
      return next();
    }

    // Check custom role permissions
    if (!membership.roleId) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const perms = await db.select({ permission: orgRolePermissions.permission })
      .from(orgRolePermissions)
      .where(eq(orgRolePermissions.roleId, membership.roleId));

    const hasPermission = perms.some(p => p.permission === permission);
    if (!hasPermission) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    return next();
  };
}
