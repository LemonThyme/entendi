import { eq } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { conceptAliases, concepts } from '../db/schema.js';
import { applyEnrichment, enrichConcept } from './concept-enrichment.js';
import { normalizeConcept, resolveConceptId } from './concept-normalize.js';
import { embedConcept, findSimilarConcepts, storeEmbedding } from './embeddings.js';

export interface ResolvedConcept {
  canonicalId: string;
  isNew: boolean;
}

/**
 * Full three-tier concept resolution pipeline.
 *
 * Tier 1: Deterministic normalization (lowercase, kebab-case, dedup dashes)
 * Tier 2: Embedding similarity via pgvector (cosine > 0.9 → merge)
 * Tier 3: LLM enrichment for genuinely new concepts (async, non-blocking)
 *
 * @param db - Database connection
 * @param rawId - Raw concept ID string from the observe request
 * @param ai - Workers AI binding (null in local dev → skip tier 2)
 */
export async function resolveConcept(
  db: Database,
  rawId: string,
  ai?: any,
): Promise<ResolvedConcept> {
  // Tier 1: Deterministic normalization
  const normalized = normalizeConcept(rawId);

  // Check alias table first
  const aliasResolved = await resolveConceptId(db, rawId);
  if (aliasResolved !== normalized) {
    return { canonicalId: aliasResolved, isNew: false };
  }

  // Check if concept already exists
  const [existing] = await db.select({ id: concepts.id })
    .from(concepts).where(eq(concepts.id, normalized));
  if (existing) {
    return { canonicalId: normalized, isNew: false };
  }

  // Tier 2: Embedding similarity (skipped when AI binding unavailable)
  const embedding = await embedConcept(ai, normalized);
  if (embedding) {
    const similar = await findSimilarConcepts(db, embedding, 0.9, 1);
    if (similar.length > 0) {
      // Found a match — create alias and resolve to existing
      await db.insert(conceptAliases).values({
        alias: normalized,
        canonicalId: similar[0].conceptId,
      }).onConflictDoNothing();
      return { canonicalId: similar[0].conceptId, isNew: false };
    }
  }

  // No match — insert as new concept
  await db.insert(concepts).values({
    id: normalized,
    domain: 'general',
    specificity: 'topic',
  }).onConflictDoNothing();

  // Store embedding for future similarity searches
  if (embedding) {
    await storeEmbedding(db, normalized, embedding);
  }

  // Tier 3: LLM enrichment (non-blocking — don't wait for it)
  enrichConcept(normalized).then(async (result) => {
    if (result) {
      await applyEnrichment(db, normalized, result);
      // Re-embed with description for better future matches
      if (ai && result.description) {
        const descEmbedding = await embedConcept(ai, `${normalized}: ${result.description}`);
        if (descEmbedding) {
          await storeEmbedding(db, normalized, descEmbedding);
        }
      }
    }
  }).catch(() => {}); // Non-critical — enrichment failure should not block observe

  return { canonicalId: normalized, isNew: true };
}
