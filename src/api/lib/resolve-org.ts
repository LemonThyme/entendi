import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { member } from '../db/schema.js';
import type { Env } from '../index.js';

/**
 * Resolve the user's active org ID.
 *
 * Priority:
 * 1. session.activeOrganizationId (set by browser session auth)
 * 2. X-Org-Id header (validated against membership — used by MCP/hooks)
 * 3. Single-org fallback (user belongs to exactly one org)
 * 4. Error if user has multiple orgs and no explicit selection
 */
export async function resolveOrgId(c: Context<Env>): Promise<string | null> {
  const session = c.get('session');
  if (session?.activeOrganizationId) return session.activeOrganizationId;

  const userId = c.get('user')?.id;
  if (!userId) return null;

  const db = c.get('db');

  // Check X-Org-Id header (API key auth path)
  const headerOrgId = c.req.header('X-Org-Id');
  if (headerOrgId) {
    const [membership] = await db.select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, headerOrgId)))
      .limit(1);

    if (!membership) {
      // User is not a member of the requested org
      return null;
    }
    return headerOrgId;
  }

  // No explicit org — check memberships
  const memberships = await db.select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(2);

  if (memberships.length === 0) return null;
  if (memberships.length === 1) return memberships[0].organizationId;

  // Multiple orgs, no selection — return null (caller should return 400)
  return null;
}
