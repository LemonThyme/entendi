import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { conceptEdges, concepts } from '../db/schema.js';

export interface EnrichmentResult {
  canonicalName: string;
  description: string;
  parent: string | null;
  prerequisites: string[];
}

const ENRICHMENT_PROMPT = `Given the technical concept "{concept}", provide:
1. canonical_name: the most standard name for this concept (kebab-case, e.g. "thompson-sampling")
2. description: one sentence explaining what it is
3. parent: the broader concept this belongs to (kebab-case), or null if top-level
4. prerequisites: direct prerequisites needed to understand this (array of kebab-case IDs, max 5)

Respond ONLY with a JSON object, no markdown.`;

/**
 * Enrich a new concept with metadata via Claude API.
 * Returns null if ANTHROPIC_API_KEY is not configured or on failure.
 */
export async function enrichConcept(conceptId: string, apiKey?: string): Promise<EnrichmentResult | null> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const client = new Anthropic({ apiKey: key });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: ENRICHMENT_PROMPT.replace('{concept}', conceptId.replace(/-/g, ' ')),
    }],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  try {
    const parsed = JSON.parse(text);
    return {
      canonicalName: String(parsed.canonical_name || conceptId),
      description: String(parsed.description || ''),
      parent: parsed.parent ? String(parsed.parent) : null,
      prerequisites: Array.isArray(parsed.prerequisites)
        ? parsed.prerequisites.map(String).slice(0, 5)
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Apply enrichment results to the database.
 * Creates prerequisite edges, updates description, sets parent.
 */
export async function applyEnrichment(
  db: Database,
  conceptId: string,
  enrichment: EnrichmentResult,
): Promise<void> {
  // Update concept description
  await db.update(concepts)
    .set({ description: enrichment.description })
    .where(eq(concepts.id, conceptId));

  // Set parent if provided
  if (enrichment.parent) {
    // Ensure parent concept exists
    await db.insert(concepts).values({
      id: enrichment.parent,
      domain: 'general',
      specificity: 'topic',
    }).onConflictDoNothing();

    await db.update(concepts)
      .set({ parentId: enrichment.parent })
      .where(eq(concepts.id, conceptId));
  }

  // Create prerequisite edges
  for (const prereqId of enrichment.prerequisites) {
    // Ensure prerequisite concept exists
    await db.insert(concepts).values({
      id: prereqId,
      domain: 'general',
      specificity: 'topic',
    }).onConflictDoNothing();

    // Create edge: conceptId requires prereqId
    await db.insert(conceptEdges).values({
      sourceId: conceptId,
      targetId: prereqId,
      edgeType: 'requires',
      source: 'llm',
    }).onConflictDoNothing();
  }
}
