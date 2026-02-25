import { type MasteryState, type RubricScore, pMastery } from '../schemas/types.js';

// FSRS-4.5 simplified constants
const DECAY = -0.5;
const FACTOR = 19 / 81; // calibrated so R(S, S) = 0.9

/** Power-law forgetting curve. Returns probability of recall at time t (days). */
export function retrievability(t: number, S: number): number {
  if (t <= 0) return 1.0;
  if (S <= 0) return 0.0;
  return Math.pow(1 + FACTOR * t / S, DECAY);
}

const PRIOR_MU = 0.0;
const PRIOR_SIGMA = 1.5;

/** Blend posterior with initial prior based on retrievability. */
export function decayPrior(mu: number, sigma: number, R: number): MasteryState {
  return {
    mu: R * mu + (1 - R) * PRIOR_MU,
    sigma: R * sigma + (1 - R) * PRIOR_SIGMA,
  };
}

const NOISE = 1.0;

/** Elo-like Kalman update from spec Section 13.1. */
export function bayesianUpdate(mastery: MasteryState, score: RubricScore): MasteryState {
  const { mu, sigma } = mastery;
  const expectedScore = 3 * pMastery(mu);
  const surprise = score - expectedScore;
  const K = (sigma * sigma) / (sigma * sigma + NOISE);
  const newMu = mu + K * surprise;
  const newSigma = sigma * Math.sqrt(1 - K);
  return { mu: newMu, sigma: newSigma };
}

/** FSRS-inspired stability after successful recall (grades 2-4). */
export function fsrsStabilityAfterSuccess(S: number, D: number, R: number, grade: 1 | 2 | 3 | 4): number {
  const hardPenalty = grade === 2 ? 0.6 : 1;
  const easyBonus = grade === 4 ? 1.9 : 1;
  const newS = S * (1 + Math.exp(1.87) * Math.pow(11 - D, 1) * Math.pow(S, -0.17) * (Math.exp(0.8 * (1 - R)) - 1) * hardPenalty * easyBonus);
  return Math.max(0.1, newS);
}

/** FSRS difficulty update. */
export function fsrsDifficultyUpdate(D: number, grade: 1 | 2 | 3 | 4): number {
  const w6 = 3.0;
  const w7 = 0.001;
  const D0_easy = 2.5;
  const deltaD = -w6 * (grade - 3);
  const damped = deltaD * (10 - D) / 9;
  const nextD = D + damped;
  const reverted = w7 * D0_easy + (1 - w7) * nextD;
  return Math.max(1, Math.min(10, reverted));
}

/** Map 0-3 rubric to FSRS 1-4 grade. */
export function mapRubricToFsrsGrade(rubric: RubricScore): 1 | 2 | 3 | 4 {
  return (rubric + 1) as 1 | 2 | 3 | 4;
}
