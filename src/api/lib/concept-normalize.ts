import { eq } from 'drizzle-orm';
import { conceptAliases } from '../db/schema.js';
import type { Database } from '../db/connection.js';

/**
 * Deterministic concept ID normalization.
 * Tier 1 of the three-tier normalization pipeline.
 *
 * Rules:
 * 1. Lowercase
 * 2. Replace / . _ spaces with -
 * 3. Collapse consecutive -
 * 4. Strip leading/trailing -
 * 5. Truncate to 200 chars
 */
export function normalizeConcept(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\/\._ ]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

/**
 * Resolve a concept ID through normalization + alias lookup.
 * Returns the canonical concept ID.
 */
export async function resolveConceptId(db: Database, raw: string): Promise<string> {
  const normalized = normalizeConcept(raw);

  const [alias] = await db.select({ canonicalId: conceptAliases.canonicalId })
    .from(conceptAliases)
    .where(eq(conceptAliases.alias, normalized));

  return alias?.canonicalId ?? normalized;
}
