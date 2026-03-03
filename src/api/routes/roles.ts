import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { member, orgRolePermissions, orgRoles } from '../db/schema.js';
import type { Env } from '../index.js';
import { resolveOrgId } from '../lib/resolve-org.js';
import { requireAuth } from '../middleware/auth.js';

export const roleRoutes = new Hono<Env>();

roleRoutes.use('*', requireAuth);

const VALID_PERMISSIONS = [
  'codebases.create', 'codebases.edit', 'codebases.delete', 'codebases.view_progress',
  'syllabi.create', 'syllabi.edit', 'syllabi.delete', 'syllabi.view_progress',
  'members.invite', 'members.manage_roles', 'members.view',
  'org.settings', 'org.billing',
] as const;

const createRoleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  permissions: z.array(z.enum(VALID_PERMISSIONS)).min(1),
  isDefault: z.boolean().optional(),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  permissions: z.array(z.enum(VALID_PERMISSIONS)).optional(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown, c: Context<Env>): T | Response {
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.issues }, 400);
  }
  return result.data;
}

async function requireOwnerOrAdmin(c: Context<Env>): Promise<{ orgId: string } | Response> {
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const user = c.get('user')!;
  const db = c.get('db');

  const [membership] = await db.select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, user.id), eq(member.organizationId, orgId)))
    .limit(1);

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return { orgId };
}

// --- POST / (create role) ---
roleRoutes.post('/', async (c) => {
  const authResult = await requireOwnerOrAdmin(c);
  if (authResult instanceof Response) return authResult;
  const { orgId } = authResult;

  const db = c.get('db');
  const raw = await c.req.json();
  const parsed = parseBody(createRoleSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  // Check for duplicate name in same org
  const [existing] = await db.select({ id: orgRoles.id })
    .from(orgRoles)
    .where(and(eq(orgRoles.orgId, orgId), eq(orgRoles.name, parsed.name)))
    .limit(1);

  if (existing) {
    return c.json({ error: 'A role with this name already exists in this organization' }, 409);
  }

  const id = crypto.randomUUID();

  await db.insert(orgRoles).values({
    id,
    orgId,
    name: parsed.name,
    description: parsed.description ?? null,
    isDefault: parsed.isDefault ?? false,
  });

  if (parsed.permissions.length > 0) {
    await db.insert(orgRolePermissions).values(
      parsed.permissions.map((permission) => ({ roleId: id, permission })),
    );
  }

  const [created] = await db.select().from(orgRoles).where(eq(orgRoles.id, id));
  const perms = await db.select({ permission: orgRolePermissions.permission })
    .from(orgRolePermissions)
    .where(eq(orgRolePermissions.roleId, id));

  return c.json({ ...created, permissions: perms.map((p) => p.permission) }, 201);
});

// --- GET / (list roles for active org) ---
roleRoutes.get('/', async (c) => {
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const db = c.get('db');

  const roles = await db.select().from(orgRoles).where(eq(orgRoles.orgId, orgId));

  const rolesWithPerms = await Promise.all(roles.map(async (role) => {
    const perms = await db.select({ permission: orgRolePermissions.permission })
      .from(orgRolePermissions)
      .where(eq(orgRolePermissions.roleId, role.id));
    return { ...role, permissions: perms.map((p) => p.permission) };
  }));

  return c.json(rolesWithPerms);
});

// --- PUT /:id (update role) ---
roleRoutes.put('/:id', async (c) => {
  const authResult = await requireOwnerOrAdmin(c);
  if (authResult instanceof Response) return authResult;
  const { orgId } = authResult;

  const db = c.get('db');
  const roleId = c.req.param('id');

  const [role] = await db.select().from(orgRoles)
    .where(and(eq(orgRoles.id, roleId), eq(orgRoles.orgId, orgId)));
  if (!role) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json();
  const parsed = parseBody(updateRoleSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  // Check for duplicate name if name is being changed
  if (parsed.name && parsed.name !== role.name) {
    const [existing] = await db.select({ id: orgRoles.id })
      .from(orgRoles)
      .where(and(eq(orgRoles.orgId, orgId), eq(orgRoles.name, parsed.name)))
      .limit(1);
    if (existing) {
      return c.json({ error: 'A role with this name already exists in this organization' }, 409);
    }
  }

  const updates: Record<string, unknown> = {};
  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.description !== undefined) updates.description = parsed.description;

  if (Object.keys(updates).length > 0) {
    await db.update(orgRoles).set(updates).where(eq(orgRoles.id, roleId));
  }

  // Replace permissions if provided
  if (parsed.permissions) {
    await db.delete(orgRolePermissions).where(eq(orgRolePermissions.roleId, roleId));
    if (parsed.permissions.length > 0) {
      await db.insert(orgRolePermissions).values(
        parsed.permissions.map((permission) => ({ roleId, permission })),
      );
    }
  }

  const [updated] = await db.select().from(orgRoles).where(eq(orgRoles.id, roleId));
  const perms = await db.select({ permission: orgRolePermissions.permission })
    .from(orgRolePermissions)
    .where(eq(orgRolePermissions.roleId, roleId));

  return c.json({ ...updated, permissions: perms.map((p) => p.permission) });
});

// --- DELETE /:id (delete role) ---
roleRoutes.delete('/:id', async (c) => {
  const authResult = await requireOwnerOrAdmin(c);
  if (authResult instanceof Response) return authResult;
  const { orgId } = authResult;

  const db = c.get('db');
  const roleId = c.req.param('id');

  const [role] = await db.select().from(orgRoles)
    .where(and(eq(orgRoles.id, roleId), eq(orgRoles.orgId, orgId)));
  if (!role) return c.json({ error: 'Not found' }, 404);

  if (role.isDefault) {
    return c.json({ error: 'Cannot delete built-in roles' }, 400);
  }

  await db.delete(orgRoles).where(eq(orgRoles.id, roleId));
  return c.json({ deleted: true });
});
