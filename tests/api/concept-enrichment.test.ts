import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichConcept, applyEnrichment, type EnrichmentResult } from '../../src/api/lib/concept-enrichment.js';

// Mock the Anthropic SDK — must use a class so `new Anthropic()` works
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: any) {
    this.messages = { create: vi.fn() };
  });
  return { default: MockAnthropic };
});

describe('enrichConcept', () => {
  it('returns null when no API key is available', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const result = await enrichConcept('thompson-sampling');
    expect(result).toBeNull();
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it('parses valid JSON response from Claude', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          canonical_name: 'thompson-sampling',
          description: 'A Bayesian approach to the multi-armed bandit problem.',
          parent: 'bayesian-methods',
          prerequisites: ['probability-theory', 'bayesian-inference'],
        }),
      }],
    });
    vi.mocked(Anthropic).mockImplementation(function (this: any) {
      this.messages = { create: mockCreate };
    } as any);

    const result = await enrichConcept('thompson-sampling', 'test-key');
    expect(result).toEqual({
      canonicalName: 'thompson-sampling',
      description: 'A Bayesian approach to the multi-armed bandit problem.',
      parent: 'bayesian-methods',
      prerequisites: ['probability-theory', 'bayesian-inference'],
    });
  });

  it('returns null on invalid JSON response', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json' }],
    });
    vi.mocked(Anthropic).mockImplementation(function (this: any) {
      this.messages = { create: mockCreate };
    } as any);

    const result = await enrichConcept('bad-concept', 'test-key');
    expect(result).toBeNull();
  });

  it('truncates prerequisites to max 5', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          canonical_name: 'machine-learning',
          description: 'Algorithms that learn from data.',
          parent: 'computer-science',
          prerequisites: ['linear-algebra', 'calculus', 'statistics', 'probability', 'python', 'optimization', 'data-structures'],
        }),
      }],
    });
    vi.mocked(Anthropic).mockImplementation(function (this: any) {
      this.messages = { create: mockCreate };
    } as any);

    const result = await enrichConcept('machine-learning', 'test-key');
    expect(result!.prerequisites).toHaveLength(5);
  });

  it('handles null parent gracefully', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          canonical_name: 'mathematics',
          description: 'The study of numbers, shapes, and patterns.',
          parent: null,
          prerequisites: [],
        }),
      }],
    });
    vi.mocked(Anthropic).mockImplementation(function (this: any) {
      this.messages = { create: mockCreate };
    } as any);

    const result = await enrichConcept('mathematics', 'test-key');
    expect(result!.parent).toBeNull();
    expect(result!.prerequisites).toEqual([]);
  });
});

describe('applyEnrichment', () => {
  const enrichment: EnrichmentResult = {
    canonicalName: 'thompson-sampling',
    description: 'A Bayesian approach to the multi-armed bandit problem.',
    parent: 'bayesian-methods',
    prerequisites: ['probability-theory', 'bayesian-inference'],
  };

  it('updates concept description', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const mockInsert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    const mockDb = {
      update: mockUpdate,
      insert: mockInsert,
      select: mockSelect,
    } as any;

    await applyEnrichment(mockDb, 'thompson-sampling', enrichment);

    // Should have called update for description
    expect(mockUpdate).toHaveBeenCalled();
    // Should have called insert for parent + 2 prerequisites + 2 edges = 5 inserts
    expect(mockInsert).toHaveBeenCalled();
  });

  it('skips parent creation when parent is null', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const insertCalls: any[] = [];
    const mockInsert = vi.fn().mockImplementation(() => {
      const call = {
        values: vi.fn().mockImplementation((v) => {
          insertCalls.push(v);
          return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
        }),
      };
      return call;
    });
    const mockDb = {
      update: mockUpdate,
      insert: mockInsert,
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any;

    const noParent: EnrichmentResult = {
      ...enrichment,
      parent: null,
      prerequisites: [],
    };
    await applyEnrichment(mockDb, 'thompson-sampling', noParent);

    // Only 1 update call (description), no inserts for parent or prereqs
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
