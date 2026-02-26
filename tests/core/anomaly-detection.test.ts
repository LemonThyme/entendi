// tests/core/anomaly-detection.test.ts
import { describe, it, expect } from 'vitest';
import { computeAnomalySignals } from '../../src/core/anomaly-detection.js';

describe('anomaly-detection', () => {
  it('returns zero signals for a normal user', () => {
    const signals = computeAnomalySignals({
      recentScores: [1, 2, 1, 2, 2],
      historicalScores: [1, 1, 2, 1, 2, 1, 2, 1],
      populationScoresForConcepts: { redis: [1, 1, 2, 1, 2] },
      userScoresForConcepts: { redis: [2] },
      dismissCount: 1,
      probeCount: 10,
      recentMasteryChanges: [0.02, 0.03, -0.01],
      populationMasteryVelocity: { mean: 0.02, std: 0.01 },
    });
    expect(signals.zSelf).toBeLessThan(2);
    expect(signals.zPopulation).toBeLessThan(2);
  });

  it('detects sudden score inflation (high zSelf)', () => {
    const signals = computeAnomalySignals({
      recentScores: [3, 3, 3, 3, 3],
      historicalScores: [0, 1, 0, 1, 1, 0, 1, 0, 1, 1],
      populationScoresForConcepts: {},
      userScoresForConcepts: {},
      dismissCount: 0,
      probeCount: 15,
      recentMasteryChanges: [],
      populationMasteryVelocity: { mean: 0, std: 1 },
    });
    expect(signals.zSelf).toBeGreaterThan(2);
  });

  it('detects outlier vs population (high zPopulation)', () => {
    const signals = computeAnomalySignals({
      recentScores: [3],
      historicalScores: [3],
      populationScoresForConcepts: { 'mcmc-sampling': [0, 1, 1, 0, 1, 1, 0] },
      userScoresForConcepts: { 'mcmc-sampling': [3] },
      dismissCount: 0,
      probeCount: 1,
      recentMasteryChanges: [],
      populationMasteryVelocity: { mean: 0, std: 1 },
    });
    expect(signals.zPopulation).toBeGreaterThan(1.5);
  });

  it('tracks dismiss ratio', () => {
    const signals = computeAnomalySignals({
      recentScores: [],
      historicalScores: [],
      populationScoresForConcepts: {},
      userScoresForConcepts: {},
      dismissCount: 8,
      probeCount: 10,
      recentMasteryChanges: [],
      populationMasteryVelocity: { mean: 0, std: 1 },
    });
    expect(signals.dismissRatio).toBeCloseTo(0.8);
  });

  it('handles empty data gracefully', () => {
    const signals = computeAnomalySignals({
      recentScores: [],
      historicalScores: [],
      populationScoresForConcepts: {},
      userScoresForConcepts: {},
      dismissCount: 0,
      probeCount: 0,
      recentMasteryChanges: [],
      populationMasteryVelocity: { mean: 0, std: 1 },
    });
    expect(signals.zSelf).toBe(0);
    expect(signals.zPopulation).toBe(0);
    expect(signals.dismissRatio).toBe(0);
    expect(signals.compositeScore).toBe(0);
  });
});
