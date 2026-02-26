import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveConcept } from '../../src/api/lib/concept-pipeline.js';

// Mock dependencies
vi.mock('../../src/api/lib/concept-normalize.js', () => ({
  normalizeConcept: vi.fn((raw: string) =>
    raw.toLowerCase().replace(/[\/\._ ]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 200)
  ),
  resolveConceptId: vi.fn(),
}));

vi.mock('../../src/api/lib/embeddings.js', () => ({
  embedConcept: vi.fn(),
  findSimilarConcepts: vi.fn(),
  storeEmbedding: vi.fn(),
}));

vi.mock('../../src/api/lib/concept-enrichment.js', () => ({
  enrichConcept: vi.fn(),
  applyEnrichment: vi.fn(),
}));

import { resolveConceptId } from '../../src/api/lib/concept-normalize.js';
import { embedConcept, findSimilarConcepts, storeEmbedding } from '../../src/api/lib/embeddings.js';
import { enrichConcept } from '../../src/api/lib/concept-enrichment.js';

describe('resolveConcept', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: resolveConceptId returns the normalized form (no alias)
    vi.mocked(resolveConceptId).mockImplementation(async (_db, raw) =>
      raw.toLowerCase().replace(/[\/\._ ]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 200)
    );

    // Default: no embeddings available (local dev)
    vi.mocked(embedConcept).mockResolvedValue(null);
    vi.mocked(findSimilarConcepts).mockResolvedValue([]);
    vi.mocked(storeEmbedding).mockResolvedValue(undefined);
    vi.mocked(enrichConcept).mockResolvedValue(null);

    mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]), // concept doesn't exist
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    };
  });

  it('returns existing canonical ID when alias exists', async () => {
    vi.mocked(resolveConceptId).mockResolvedValue('a-b-testing');

    const result = await resolveConcept(mockDb, 'AB Testing');
    expect(result).toEqual({ canonicalId: 'a-b-testing', isNew: false });
    // Should not check DB or embeddings
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(embedConcept).not.toHaveBeenCalled();
  });

  it('returns existing concept when it already exists in DB', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'react-hooks' }]),
      }),
    });

    const result = await resolveConcept(mockDb, 'React Hooks');
    expect(result).toEqual({ canonicalId: 'react-hooks', isNew: false });
    expect(embedConcept).not.toHaveBeenCalled();
  });

  it('resolves to similar concept via embedding match (tier 2)', async () => {
    const fakeEmbedding = new Array(768).fill(0.1);
    vi.mocked(embedConcept).mockResolvedValue(fakeEmbedding);
    vi.mocked(findSimilarConcepts).mockResolvedValue([
      { conceptId: 'a-b-testing', similarity: 0.95 },
    ]);

    const result = await resolveConcept(mockDb, 'ab-testing', { /* mock AI */ });
    expect(result).toEqual({ canonicalId: 'a-b-testing', isNew: false });
    // Should create alias
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('inserts new concept when no match found (no AI)', async () => {
    const result = await resolveConcept(mockDb, 'Thompson Sampling');
    expect(result).toEqual({ canonicalId: 'thompson-sampling', isNew: true });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('inserts new concept and stores embedding when AI is available', async () => {
    const fakeEmbedding = new Array(768).fill(0.1);
    vi.mocked(embedConcept).mockResolvedValue(fakeEmbedding);
    vi.mocked(findSimilarConcepts).mockResolvedValue([]); // no similar concepts

    const result = await resolveConcept(mockDb, 'Thompson Sampling', { /* mock AI */ });
    expect(result).toEqual({ canonicalId: 'thompson-sampling', isNew: true });
    expect(storeEmbedding).toHaveBeenCalledWith(mockDb, 'thompson-sampling', fakeEmbedding);
  });

  it('skips embedding tier when AI binding is null (local dev)', async () => {
    const result = await resolveConcept(mockDb, 'new-concept', null);
    expect(result.isNew).toBe(true);
    expect(embedConcept).toHaveBeenCalledWith(null, 'new-concept');
    expect(findSimilarConcepts).not.toHaveBeenCalled();
    expect(storeEmbedding).not.toHaveBeenCalled();
  });

  it('triggers enrichment for new concepts (non-blocking)', async () => {
    vi.mocked(enrichConcept).mockResolvedValue(null);

    const result = await resolveConcept(mockDb, 'new-concept');
    expect(result.isNew).toBe(true);
    // enrichConcept was called (fire-and-forget)
    expect(enrichConcept).toHaveBeenCalledWith('new-concept');
  });

  it('normalizes input through the pipeline', async () => {
    const result = await resolveConcept(mockDb, 'A/B Testing');
    expect(result.canonicalId).toBe('a-b-testing');
  });
});
