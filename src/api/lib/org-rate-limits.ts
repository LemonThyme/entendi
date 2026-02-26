import { eq } from 'drizzle-orm';
import { member, organization } from '../db/schema.js';
import type { Database } from '../db/connection.js';

export interface OrgRateLimits {
  /** Max probe evaluations per concept per window. 0 = unlimited. Default: 1 */
  probeEvalsPerConcept: number;
  /** Window for per-concept rate limit in hours. Default: 24 */
  probeEvalWindowHours: number;
  /** Min interval between probes in seconds. 0 = no limit. Default: 120 */
  probeIntervalSeconds: number;
  /** Max probes per hour. 0 = unlimited. Default: 15 */
  maxProbesPerHour: number;
}

const DEFAULTS: OrgRateLimits = {
  probeEvalsPerConcept: 1,
  probeEvalWindowHours: 24,
  probeIntervalSeconds: 120,
  maxProbesPerHour: 15,
};

const UNLIMITED: OrgRateLimits = {
  probeEvalsPerConcept: 0,
  probeEvalWindowHours: 0,
  probeIntervalSeconds: 0,
  maxProbesPerHour: 0,
};

/**
 * Get the effective rate limits for a user based on their org membership.
 *
 * Org metadata JSON can contain:
 *   - `rateLimitExempt: true` — all limits disabled
 *   - `rateLimits: { probeEvalsPerConcept, probeEvalWindowHours, probeIntervalSeconds, maxProbesPerHour }`
 *
 * If the user belongs to multiple orgs, the most permissive limits win.
 */
export async function getOrgRateLimits(db: Database, userId: string): Promise<OrgRateLimits> {
  const memberships = await db
    .select({ metadata: organization.metadata })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId));

  let effective = { ...DEFAULTS };

  for (const row of memberships) {
    if (!row.metadata) continue;
    try {
      const parsed = JSON.parse(row.metadata);
      if (parsed.rateLimitExempt === true) return { ...UNLIMITED };
      if (parsed.rateLimits) {
        const rl = parsed.rateLimits;
        // Most permissive wins: lower values = more permissive (0 = unlimited)
        if (typeof rl.probeEvalsPerConcept === 'number') {
          effective.probeEvalsPerConcept = rl.probeEvalsPerConcept === 0
            ? 0
            : Math.max(effective.probeEvalsPerConcept, rl.probeEvalsPerConcept);
        }
        if (typeof rl.probeEvalWindowHours === 'number') {
          effective.probeEvalWindowHours = rl.probeEvalWindowHours === 0
            ? 0
            : Math.min(effective.probeEvalWindowHours, rl.probeEvalWindowHours);
        }
        if (typeof rl.probeIntervalSeconds === 'number') {
          effective.probeIntervalSeconds = rl.probeIntervalSeconds === 0
            ? 0
            : Math.min(effective.probeIntervalSeconds, rl.probeIntervalSeconds);
        }
        if (typeof rl.maxProbesPerHour === 'number') {
          effective.maxProbesPerHour = rl.maxProbesPerHour === 0
            ? 0
            : Math.max(effective.maxProbesPerHour, rl.maxProbesPerHour);
        }
      }
    } catch {
      // ignore malformed metadata
    }
  }

  return effective;
}
