import { describe, it, expect } from 'vitest';
import { shouldProbe, selectConceptToProbe } from '../../src/core/probe-scheduler.js';
import type { NoveltyLevel } from '../../src/schemas/types.js';
import { DEFAULT_GRM_PARAMS } from '../../src/schemas/types.js';

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
      { conceptId: 'a', mu: 0, sigma: 0.3, stability: 5.0, daysSinceAssessment: 1, itemParams: DEFAULT_GRM_PARAMS },
      { conceptId: 'b', mu: 0, sigma: 1.5, stability: 1.0, daysSinceAssessment: 30, itemParams: DEFAULT_GRM_PARAMS },
      { conceptId: 'c', mu: 2, sigma: 0.2, stability: 30.0, daysSinceAssessment: 0, itemParams: DEFAULT_GRM_PARAMS },
    ];
    const selected = selectConceptToProbe(candidates);
    // 'b' has low stability + high days since assessment = high decay bonus, and mu=0 gives max Fisher info
    expect(selected).toBe('b');
  });

  it('prefers stale concepts over fresh ones', () => {
    const candidates = [
      { conceptId: 'fresh', mu: 0, sigma: 1.0, stability: 5.0, daysSinceAssessment: 0, itemParams: DEFAULT_GRM_PARAMS },
      { conceptId: 'stale', mu: 0, sigma: 1.0, stability: 5.0, daysSinceAssessment: 60, itemParams: DEFAULT_GRM_PARAMS },
    ];
    expect(selectConceptToProbe(candidates)).toBe('stale');
  });
});

describe('selectConceptToProbe (Fisher info)', () => {
  it('uses stability and Fisher information instead of sigma proxy', () => {
    const candidates = [
      { conceptId: 'a', mu: 0.0, sigma: 1.5, stability: 1.0, daysSinceAssessment: 10, itemParams: DEFAULT_GRM_PARAMS },
      { conceptId: 'b', mu: 0.0, sigma: 0.5, stability: 30.0, daysSinceAssessment: 1, itemParams: DEFAULT_GRM_PARAMS },
    ];
    const selected = selectConceptToProbe(candidates);
    expect(selected).toBe('a'); // Lower stability = higher decay bonus
  });

  it('prefers concepts with higher Fisher information', () => {
    const candidates = [
      { conceptId: 'easy', mu: 0.0, sigma: 1.0, stability: 5.0, daysSinceAssessment: 5, itemParams: { discrimination: 0.5, thresholds: [-1, 0, 1] as [number, number, number] } },
      { conceptId: 'hard', mu: 0.0, sigma: 1.0, stability: 5.0, daysSinceAssessment: 5, itemParams: { discrimination: 2.0, thresholds: [-1, 0, 1] as [number, number, number] } },
    ];
    const selected = selectConceptToProbe(candidates);
    expect(selected).toBe('hard'); // Higher discrimination = more Fisher info
  });
});
