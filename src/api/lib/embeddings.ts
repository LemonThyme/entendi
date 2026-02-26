import { sql } from 'drizzle-orm';
import type { Database } from '../db/connection.js';

export interface EmbeddingResult {
  conceptId: string;
  similarity: number;
}

/**
 * Generate an embedding for a concept using Workers AI (bge-base-en-v1.5).
 * Returns null if Workers AI is not available (local dev).
 */
export async function embedConcept(ai: any, conceptId: string): Promise<number[] | null> {
  if (!ai) return null;
  try {
    const result = await ai.run('@cf/baai/bge-base-en-v1.5', {
      text: [conceptId.replace(/-/g, ' ')],
    });
    return result?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Find similar concepts by embedding cosine similarity.
 * Uses pgvector's cosine distance operator.
 */
export async function findSimilarConcepts(
  db: Database,
  embedding: number[],
  threshold: number = 0.9,
  limit: number = 5,
): Promise<EmbeddingResult[]> {
  const embeddingStr = `[${embedding.join(',')}]`;
  const rows = await db.execute(sql`
    SELECT concept_id, 1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM concept_embeddings
    WHERE 1 - (embedding <=> ${embeddingStr}::vector) > ${threshold}
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `);
  return (rows.rows || []).map((r: any) => ({
    conceptId: r.concept_id,
    similarity: parseFloat(r.similarity),
  }));
}

/**
 * Store a concept embedding (upsert).
 */
export async function storeEmbedding(
  db: Database,
  conceptId: string,
  embedding: number[],
): Promise<void> {
  const embeddingStr = `[${embedding.join(',')}]`;
  await db.execute(sql`
    INSERT INTO concept_embeddings (concept_id, embedding)
    VALUES (${conceptId}, ${embeddingStr}::vector)
    ON CONFLICT (concept_id) DO UPDATE SET embedding = ${embeddingStr}::vector
  `);
}

/**
 * Get the cosine similarity between two concepts.
 * Returns 0 if either concept has no embedding.
 */
export async function conceptSimilarity(
  db: Database,
  conceptA: string,
  conceptB: string,
): Promise<number> {
  if (conceptA === conceptB) return 1.0;
  const rows = await db.execute(sql`
    SELECT 1 - (a.embedding <=> b.embedding) AS similarity
    FROM concept_embeddings a, concept_embeddings b
    WHERE a.concept_id = ${conceptA} AND b.concept_id = ${conceptB}
  `);
  return (rows.rows?.[0] as any)?.similarity ? parseFloat((rows.rows[0] as any).similarity) : 0;
}
