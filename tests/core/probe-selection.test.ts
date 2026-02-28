import { describe, expect, it } from 'vitest';
import { expectedInfoGain, type ProbeCandidate, selectProbeCandidate } from '../../src/core/probe-selection.js';

describe('expectedInfoGain', () => {
  it('returns higher gain for uncertain concepts', () => {
    const highSigma = expectedInfoGain(1.5, 1.0);
    const lowSigma = expectedInfoGain(0.3, 1.0);
    expect(highSigma).toBeGreaterThan(lowSigma);
  });

  it('returns higher gain when Fisher info is higher', () => {
    const highFisher = expectedInfoGain(1.0, 2.0);
    const lowFisher = expectedInfoGain(1.0, 0.5);
    expect(highFisher).toBeGreaterThan(lowFisher);
  });

  it('returns 0 when sigma is 0', () => {
    expect(expectedInfoGain(0, 1.0)).toBeCloseTo(0);
  });

  it('returns 0 when Fisher info is 0', () => {
    expect(expectedInfoGain(1.0, 0)).toBeCloseTo(0);
  });

  it('is always non-negative', () => {
    expect(expectedInfoGain(0.5, 0.3)).toBeGreaterThanOrEqual(0);
    expect(expectedInfoGain(1.5, 2.0)).toBeGreaterThanOrEqual(0);
  });

  it('converges to sigma^2 as Fisher info grows very large', () => {
    const sigma = 1.0;
    const gain = expectedInfoGain(sigma, 1e10);
    // When Fisher info is huge, posterior variance → 0, so gain → sigma^2
    expect(gain).toBeCloseTo(sigma * sigma, 2);
  });
});

describe('selectProbeCandidate', () => {
  const candidates: ProbeCandidate[] = [
    { conceptId: 'a-b-testing', mu: 0, sigma: 1.5, fisherInfo: 1.0, urgency: 0.9 },
    { conceptId: 'thompson-sampling', mu: 0.5, sigma: 1.2, fisherInfo: 0.8, urgency: 0.7 },
    { conceptId: 'bayesian-inference', mu: -0.3, sigma: 0.4, fisherInfo: 0.5, urgency: 0.5 },
  ];

  it('selects by info gain when no trunk', () => {
    const result = selectProbeCandidate(candidates, new Map(), false);
    // Higher sigma + higher Fisher info → a-b-testing has highest info gain
    expect(result?.selected.conceptId).toBe('a-b-testing');
    expect(result?.score).toBeGreaterThan(0);
  });

  it('prefers conversationally relevant concept when trunk is set', () => {
    // Use candidates with closer info gains so relevance can tip the balance
    const closeCandidates: ProbeCandidate[] = [
      { conceptId: 'a-b-testing', mu: 0, sigma: 1.0, fisherInfo: 0.8, urgency: 0.9 },
      { conceptId: 'thompson-sampling', mu: 0.5, sigma: 0.9, fisherInfo: 0.8, urgency: 0.7 },
    ];
    const similarities = new Map([
      ['a-b-testing', 0.0],        // completely unrelated to trunk
      ['thompson-sampling', 1.0],  // identical to trunk
    ]);
    const result = selectProbeCandidate(closeCandidates, similarities, true);
    // Thompson-sampling wins: similar info gain but much higher relevance
    expect(result?.selected.conceptId).toBe('thompson-sampling');
  });

  it('returns null for empty candidates', () => {
    expect(selectProbeCandidate([], new Map(), false)).toBeNull();
  });

  it('degrades to info gain when similarities map is empty and hasTrunk is true', () => {
    // If trunk is set but no similarities computed (edge case), relevance = 1/(1+1) = 0.5
    // All candidates get same relevance multiplier, so info gain dominates
    const result = selectProbeCandidate(candidates, new Map(), true);
    expect(result?.selected.conceptId).toBe('a-b-testing');
  });

  it('handles single candidate', () => {
    const single = [candidates[1]];
    const result = selectProbeCandidate(single, new Map(), false);
    expect(result?.selected.conceptId).toBe('thompson-sampling');
  });

  it('relevance is exactly 1.0 when hasTrunk is false regardless of similarities', () => {
    const similarities = new Map([
      ['a-b-testing', 0.1],
      ['thompson-sampling', 0.99],
      ['bayesian-inference', 0.99],
    ]);
    // Without trunk, relevance should be 1.0 for all, so info gain dominates
    const result = selectProbeCandidate(candidates, similarities, false);
    expect(result?.selected.conceptId).toBe('a-b-testing');
  });
});
