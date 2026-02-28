import { describe, expect, it } from 'vitest';
import { buildSeedConceptNodes } from '../../../src/config/seed-taxonomy.js';

describe('seed taxonomy data', () => {
  it('produces concept nodes with required fields', () => {
    const seeds = buildSeedConceptNodes();
    const ids = Object.keys(seeds);
    expect(ids.length).toBeGreaterThan(100);

    for (const node of Object.values(seeds)) {
      expect(node.conceptId).toBeDefined();
      expect(node.domain).toBeDefined();
      expect(['domain', 'topic', 'technique']).toContain(node.specificity);
      expect(node.itemParams.discrimination).toBeGreaterThan(0);
      expect(node.itemParams.thresholds).toHaveLength(3);
      expect(node.lifecycle).toBe('stable');
    }
  });

  it('all relationship targets exist in seed set', () => {
    const seeds = buildSeedConceptNodes();
    const ids = new Set(Object.keys(seeds));

    for (const node of Object.values(seeds)) {
      for (const edge of node.relationships) {
        expect(ids.has(edge.target)).toBe(true);
      }
    }
  });
});
