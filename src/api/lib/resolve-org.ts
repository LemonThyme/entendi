import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { member } from '../db/schema.js';
import type { Env } from '../index.js';

/**
 * Resolve the user's active org ID.
 * Prefers session.activeOrganizationId, falls back to their first org membership.
 * This fallback is needed because API key auth doesn't set activeOrganizationId.
 */
export async function resolveOrgId(c: Context<Env>): Promise<string | null> {
  const session = c.get('session');
  if (session?.activeOrganizationId) return session.activeOrganizationId;

  const userId = c.get('user')?.id;
  if (!userId) return null;

  const db = c.get('db');
  const [membership] = await db.select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);

  return membership?.organizationId ?? null;
}
