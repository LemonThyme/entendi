import { describe, it, expect } from 'vitest';
import {
  SEED_CONCEPTS,
  buildSeedConceptNodes,
  seedTaxonomyStats,
} from '../../src/config/seed-taxonomy.js';
import type { TaxonomySeedEntry, ConceptNode, EdgeType } from '../../src/schemas/types.js';

const VALID_EDGE_TYPES: EdgeType[] = [
  'requires', 'part_of', 'related_to', 'alternative_to', 'used_with', 'is_example_of',
];

describe('Seed Taxonomy', () => {
  it('exports a non-empty array of seed concepts', () => {
    expect(Array.isArray(SEED_CONCEPTS)).toBe(true);
    expect(SEED_CONCEPTS.length).toBeGreaterThan(50);
  });

  it('every seed has required fields', () => {
    for (const seed of SEED_CONCEPTS) {
      expect(seed.conceptId).toBeTruthy();
      expect(typeof seed.conceptId).toBe('string');
      expect(seed.conceptId).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/); // kebab-case

      expect(Array.isArray(seed.aliases)).toBe(true);
      expect(seed.aliases.length).toBeGreaterThan(0);

      expect(typeof seed.domain).toBe('string');
      expect(seed.domain).toBeTruthy();

      expect(['domain', 'topic', 'technique']).toContain(seed.specificity);

      // parentConcept is string | null
      expect(
        seed.parentConcept === null || typeof seed.parentConcept === 'string',
      ).toBe(true);

      expect(Array.isArray(seed.relationships)).toBe(true);
      for (const rel of seed.relationships) {
        expect(typeof rel.target).toBe('string');
        expect(VALID_EDGE_TYPES).toContain(rel.type);
      }
    }
  });

  it('has no duplicate concept IDs', () => {
    const ids = SEED_CONCEPTS.map((s) => s.conceptId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all relationship targets reference existing concepts', () => {
    const allIds = new Set(SEED_CONCEPTS.map((s) => s.conceptId));
    for (const seed of SEED_CONCEPTS) {
      for (const rel of seed.relationships) {
        expect(allIds.has(rel.target)).toBe(true);
      }
      if (seed.parentConcept !== null) {
        expect(allIds.has(seed.parentConcept)).toBe(true);
      }
    }
  });

  it('has no cycles in parent chain', () => {
    const parentMap = new Map<string, string | null>();
    for (const seed of SEED_CONCEPTS) {
      parentMap.set(seed.conceptId, seed.parentConcept);
    }

    for (const seed of SEED_CONCEPTS) {
      const visited = new Set<string>();
      let current: string | null = seed.conceptId;
      while (current !== null) {
        expect(visited.has(current)).toBe(false);
        visited.add(current);
        current = parentMap.get(current) ?? null;
      }
    }
  });

  it('covers all 10 required domains', () => {
    const domains = new Set(SEED_CONCEPTS.map((s) => s.domain));
    const requiredDomains = [
      'programming-languages',
      'data-structures-algorithms',
      'web-development',
      'frontend',
      'databases',
      'system-design',
      'devops',
      'testing',
      'security',
      'ai-ml',
    ];
    for (const domain of requiredDomains) {
      expect(domains.has(domain)).toBe(true);
    }
  });

  it('has all three specificity levels', () => {
    const specificities = new Set(SEED_CONCEPTS.map((s) => s.specificity));
    expect(specificities.has('domain')).toBe(true);
    expect(specificities.has('topic')).toBe(true);
    expect(specificities.has('technique')).toBe(true);
  });
});

describe('buildSeedConceptNodes', () => {
  it('returns a Record<string, ConceptNode> with all seeds', () => {
    const nodes = buildSeedConceptNodes();
    expect(typeof nodes).toBe('object');
    expect(Object.keys(nodes).length).toBe(SEED_CONCEPTS.length);

    for (const seed of SEED_CONCEPTS) {
      const node = nodes[seed.conceptId];
      expect(node).toBeDefined();
      expect(node.conceptId).toBe(seed.conceptId);
      expect(node.aliases).toEqual(seed.aliases);
      expect(node.domain).toBe(seed.domain);
      expect(node.specificity).toBe(seed.specificity);
      expect(node.parentConcept).toBe(seed.parentConcept);
      expect(node.relationships).toEqual(seed.relationships);
      expect(node.lifecycle).toBe('stable');
    }
  });

  it('each node has default itemParams and populationStats', () => {
    const nodes = buildSeedConceptNodes();
    for (const node of Object.values(nodes)) {
      expect(node.itemParams).toBeDefined();
      expect(node.itemParams.discrimination).toBe(1.0);
      expect(node.populationStats).toBeDefined();
      expect(node.populationStats.meanMastery).toBe(0);
    }
  });
});

describe('seedTaxonomyStats', () => {
  it('returns correct counts', () => {
    const stats = seedTaxonomyStats();
    expect(stats.total).toBe(SEED_CONCEPTS.length);
    expect(stats.total).toBeGreaterThan(50);

    const domainCount = new Set(SEED_CONCEPTS.map((s) => s.domain)).size;
    expect(stats.domains).toBe(domainCount);

    const topicCount = SEED_CONCEPTS.filter((s) => s.specificity === 'topic').length;
    expect(stats.topics).toBe(topicCount);

    const techniqueCount = SEED_CONCEPTS.filter(
      (s) => s.specificity === 'technique',
    ).length;
    expect(stats.techniques).toBe(techniqueCount);
  });
});
