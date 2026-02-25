import { describe, it, expect } from 'vitest';
import {
  retrievability,
  decayPrior,
  bayesianUpdate,
  fsrsStabilityAfterSuccess,
  fsrsDifficultyUpdate,
  mapRubricToFsrsGrade,
  grmCategoryProbs,
  grmBayesianUpdate,
  grmUpdate,
  grmFisherInformation,
} from '../../src/core/probabilistic-model.js';
import { createInitialMastery, createInitialMemory, type GRMItemParams } from '../../src/schemas/types.js';

describe('retrievability', () => {
  it('returns ~0.9 when t equals stability', () => {
    const R = retrievability(10, 10);
    expect(R).toBeCloseTo(0.9, 2);
  });

  it('returns 1.0 when t is 0', () => {
    expect(retrievability(0, 10)).toBeCloseTo(1.0, 5);
  });

  it('decays over time', () => {
    const r1 = retrievability(1, 10);
    const r2 = retrievability(30, 10);
    expect(r1).toBeGreaterThan(r2);
  });

  it('higher stability decays slower', () => {
    const rLowS = retrievability(10, 5);
    const rHighS = retrievability(10, 20);
    expect(rHighS).toBeGreaterThan(rLowS);
  });
});

describe('decayPrior', () => {
  it('returns posterior unchanged when R=1', () => {
    const result = decayPrior(2.0, 0.5, 1.0);
    expect(result.mu).toBeCloseTo(2.0, 5);
    expect(result.sigma).toBeCloseTo(0.5, 5);
  });

  it('regresses toward prior when R=0', () => {
    const result = decayPrior(2.0, 0.5, 0.0);
    expect(result.mu).toBeCloseTo(0.0, 5);
    expect(result.sigma).toBeCloseTo(1.5, 5);
  });

  it('partially regresses for intermediate R', () => {
    const result = decayPrior(2.0, 0.5, 0.5);
    expect(result.mu).toBeCloseTo(1.0, 5);
    expect(result.sigma).toBeCloseTo(1.0, 5);
  });
});

describe('bayesianUpdate (simplified Elo-like)', () => {
  it('increases mu when score exceeds expectation', () => {
    const mastery = createInitialMastery();
    const result = bayesianUpdate(mastery, 3);
    expect(result.mu).toBeGreaterThan(0);
  });

  it('decreases mu when score is below expectation', () => {
    const mastery = { mu: 2.0, sigma: 0.8 };
    const result = bayesianUpdate(mastery, 0);
    expect(result.mu).toBeLessThan(2.0);
  });

  it('reduces sigma after observation', () => {
    const mastery = createInitialMastery();
    const result = bayesianUpdate(mastery, 2);
    expect(result.sigma).toBeLessThan(mastery.sigma);
  });

  it('uncertain beliefs update more than confident ones', () => {
    const uncertain = { mu: 0, sigma: 1.5 };
    const confident = { mu: 0, sigma: 0.3 };
    const rUncertain = bayesianUpdate(uncertain, 3);
    const rConfident = bayesianUpdate(confident, 3);
    const deltaUncertain = rUncertain.mu - uncertain.mu;
    const deltaConfident = rConfident.mu - confident.mu;
    expect(deltaUncertain).toBeGreaterThan(deltaConfident);
  });
});

describe('FSRS stability update', () => {
  it('increases stability after successful recall', () => {
    const newS = fsrsStabilityAfterSuccess(5.0, 5.0, 0.9, 3);
    expect(newS).toBeGreaterThan(5.0);
  });

  it('easy grade increases stability more than hard', () => {
    const sHard = fsrsStabilityAfterSuccess(5.0, 5.0, 0.9, 2);
    const sEasy = fsrsStabilityAfterSuccess(5.0, 5.0, 0.9, 4);
    expect(sEasy).toBeGreaterThan(sHard);
  });
});

describe('FSRS difficulty update', () => {
  it('increases difficulty on Again grade', () => {
    const newD = fsrsDifficultyUpdate(5.0, 1);
    expect(newD).toBeGreaterThan(5.0);
  });

  it('decreases difficulty on Easy grade', () => {
    const newD = fsrsDifficultyUpdate(5.0, 4);
    expect(newD).toBeLessThan(5.0);
  });

  it('clamps to [1, 10]', () => {
    expect(fsrsDifficultyUpdate(1.0, 4)).toBeGreaterThanOrEqual(1);
    expect(fsrsDifficultyUpdate(10.0, 1)).toBeLessThanOrEqual(10);
  });
});

describe('mapRubricToFsrsGrade', () => {
  it('maps rubric 0 to Again (1)', () => { expect(mapRubricToFsrsGrade(0)).toBe(1); });
  it('maps rubric 1 to Hard (2)', () => { expect(mapRubricToFsrsGrade(1)).toBe(2); });
  it('maps rubric 2 to Good (3)', () => { expect(mapRubricToFsrsGrade(2)).toBe(3); });
  it('maps rubric 3 to Easy (4)', () => { expect(mapRubricToFsrsGrade(3)).toBe(4); });
});

// ===== GRM Tests (Task 2) =====

describe('GRM Bayesian Update', () => {
  it('returns converged result with default params and score=2', () => {
    const result = grmBayesianUpdate(2, 0.0, 1.5);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(25);
    expect(result.sigma).toBeGreaterThan(0);
    expect(result.sigma).toBeLessThan(1.5); // should shrink from prior
  });

  it('shifts mu upward for high score (3)', () => {
    const result = grmBayesianUpdate(3, 0.0, 1.5);
    expect(result.mu).toBeGreaterThan(0.0);
    expect(result.converged).toBe(true);
  });

  it('shifts mu downward for low score (0)', () => {
    const result = grmBayesianUpdate(0, 0.0, 1.5);
    expect(result.mu).toBeLessThan(0.0);
    expect(result.converged).toBe(true);
  });

  it('shifts mu less when prior sigma is small', () => {
    const wideResult = grmBayesianUpdate(3, 0.0, 1.5);
    const narrowResult = grmBayesianUpdate(3, 0.0, 0.3);
    const wideDelta = Math.abs(wideResult.mu - 0.0);
    const narrowDelta = Math.abs(narrowResult.mu - 0.0);
    expect(wideDelta).toBeGreaterThan(narrowDelta);
  });

  it('uses custom GRM item parameters', () => {
    const customParams: GRMItemParams = {
      discrimination: 2.0,
      thresholds: [-2.0, 0.0, 2.0],
    };
    const result = grmBayesianUpdate(2, 0.0, 1.5, customParams);
    expect(result.converged).toBe(true);
    // Higher discrimination should yield smaller posterior sigma
    const defaultResult = grmBayesianUpdate(2, 0.0, 1.5);
    expect(result.sigma).toBeLessThan(defaultResult.sigma);
  });

  it('converges within 25 iterations for extreme prior', () => {
    const result = grmBayesianUpdate(2, 5.0, 1.5);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(25);
  });
});

describe('grmUpdate (MasteryState wrapper)', () => {
  it('returns a MasteryState with updated mu and sigma', () => {
    const mastery = createInitialMastery();
    const result = grmUpdate(mastery, 3);
    expect(result.mu).toBeGreaterThan(mastery.mu);
    expect(result.sigma).toBeLessThan(mastery.sigma);
    expect(result.sigma).toBeGreaterThan(0);
  });

  it('decreases mu for score 0', () => {
    const mastery = { mu: 1.0, sigma: 1.0 };
    const result = grmUpdate(mastery, 0);
    expect(result.mu).toBeLessThan(mastery.mu);
  });

  it('accepts custom item parameters', () => {
    const mastery = createInitialMastery();
    const customParams: GRMItemParams = {
      discrimination: 1.5,
      thresholds: [-0.5, 0.5, 1.5],
    };
    const result = grmUpdate(mastery, 2, customParams);
    expect(result.mu).toBeDefined();
    expect(result.sigma).toBeDefined();
    expect(result.sigma).toBeGreaterThan(0);
  });
});

describe('GRM Category Probabilities', () => {
  it('category probs sum to ~1.0', () => {
    const probs = grmCategoryProbs(0.0);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('higher theta increases P(score=3)', () => {
    const probsLow = grmCategoryProbs(-2.0);
    const probsHigh = grmCategoryProbs(2.0);
    expect(probsHigh[3]).toBeGreaterThan(probsLow[3]);
  });

  it('returns 4 non-negative probabilities', () => {
    const probs = grmCategoryProbs(0.5);
    expect(probs).toHaveLength(4);
    for (const p of probs) {
      expect(p).toBeGreaterThanOrEqual(0);
    }
  });

  it('sums to 1.0 for various theta values', () => {
    for (const theta of [-3, -1, 0, 1, 3]) {
      const probs = grmCategoryProbs(theta);
      const sum = probs.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 10);
    }
  });

  it('accepts custom item parameters', () => {
    const params: GRMItemParams = {
      discrimination: 2.0,
      thresholds: [-1.5, 0.0, 1.5],
    };
    const probs = grmCategoryProbs(0.0, params);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe('GRM Fisher Information', () => {
  it('is positive for any theta', () => {
    for (const theta of [-3, -1, 0, 0.5, 1, 3]) {
      expect(grmFisherInformation(theta)).toBeGreaterThan(0);
    }
  });

  it('peaks near the middle threshold', () => {
    // Default thresholds are [-1, 0, 1], middle is 0
    const infoAtMiddle = grmFisherInformation(0.0);
    const infoFarAway = grmFisherInformation(5.0);
    expect(infoAtMiddle).toBeGreaterThan(infoFarAway);
  });

  it('scales with discrimination parameter', () => {
    const lowDiscParams: GRMItemParams = {
      discrimination: 0.5,
      thresholds: [-1.0, 0.0, 1.0],
    };
    const highDiscParams: GRMItemParams = {
      discrimination: 2.0,
      thresholds: [-1.0, 0.0, 1.0],
    };
    const infoLow = grmFisherInformation(0.0, lowDiscParams);
    const infoHigh = grmFisherInformation(0.0, highDiscParams);
    expect(infoHigh).toBeGreaterThan(infoLow);
  });
});
