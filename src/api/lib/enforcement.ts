import { eq } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { member, organization } from '../db/schema.js';

export type EnforcementLevel = 'off' | 'remind' | 'enforce';

const STRICTNESS: Record<EnforcementLevel, number> = { off: 0, remind: 1, enforce: 2 };
const DEFAULT_LEVEL: EnforcementLevel = 'remind';

export async function resolveEnforcementLevel(db: Database, userId: string): Promise<EnforcementLevel> {
  const memberships = await db
    .select({ metadata: organization.metadata })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId));

  if (memberships.length === 0) return DEFAULT_LEVEL;

  let effective: EnforcementLevel | null = null;

  for (const row of memberships) {
    if (!row.metadata) continue;
    try {
      const parsed = JSON.parse(row.metadata);
      const raw = parsed.enforcementLevel;
      if (raw === 'off' || raw === 'remind' || raw === 'enforce') {
        const level: EnforcementLevel = raw;
        if (effective === null || STRICTNESS[level] > STRICTNESS[effective]) {
          effective = level;
        }
      }
    } catch {
      // ignore malformed metadata
    }
  }

  return effective ?? DEFAULT_LEVEL;
}
