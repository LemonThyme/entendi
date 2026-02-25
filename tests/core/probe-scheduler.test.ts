import { describe, it, expect } from 'vitest';
import { shouldProbe, selectConceptToProbe } from '../../src/core/probe-scheduler.js';
import type { NoveltyLevel } from '../../src/schemas/types.js';

describe('shouldProbe', () => {
  it('probes novel concepts with high probability', () => {
    let probed = 0;
    for (let i = 0; i < 100; i++) {
      if (shouldProbe('novel')) probed++;
    }
    expect(probed).toBeGreaterThan(30);
  });

  it('probes routine concepts with low probability', () => {
    let probed = 0;
    for (let i = 0; i < 100; i++) {
      if (shouldProbe('routine')) probed++;
    }
    expect(probed).toBeLessThan(25);
  });

  it('always probes when forced', () => {
    expect(shouldProbe('novel', true)).toBe(true);
    expect(shouldProbe('routine', true)).toBe(true);
  });
});

describe('selectConceptToProbe', () => {
  it('returns null when no concepts available', () => {
    expect(selectConceptToProbe([])).toBeNull();
  });

  it('selects the concept with highest information value', () => {
    const candidates = [
      { conceptId: 'a', mu: 0, sigma: 0.3, daysSinceAssessment: 1 },
      { conceptId: 'b', mu: 0, sigma: 1.5, daysSinceAssessment: 30 },
      { conceptId: 'c', mu: 2, sigma: 0.2, daysSinceAssessment: 0 },
    ];
    const selected = selectConceptToProbe(candidates);
    expect(selected).toBe('b');
  });

  it('prefers uncertain concepts over certain ones', () => {
    const candidates = [
      { conceptId: 'certain', mu: 1, sigma: 0.1, daysSinceAssessment: 5 },
      { conceptId: 'uncertain', mu: 0, sigma: 2.0, daysSinceAssessment: 5 },
    ];
    expect(selectConceptToProbe(candidates)).toBe('uncertain');
  });

  it('prefers stale concepts over fresh ones', () => {
    const candidates = [
      { conceptId: 'fresh', mu: 0, sigma: 1.0, daysSinceAssessment: 0 },
      { conceptId: 'stale', mu: 0, sigma: 1.0, daysSinceAssessment: 60 },
    ];
    expect(selectConceptToProbe(candidates)).toBe('stale');
  });
});
