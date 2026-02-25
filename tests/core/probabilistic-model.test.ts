import { describe, it, expect } from 'vitest';
import {
  retrievability,
  decayPrior,
  bayesianUpdate,
  fsrsStabilityAfterSuccess,
  fsrsDifficultyUpdate,
  mapRubricToFsrsGrade,
} from '../../src/core/probabilistic-model.js';
import { createInitialMastery, createInitialMemory } from '../../src/schemas/types.js';

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
