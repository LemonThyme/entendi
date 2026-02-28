import { DEFAULT_GRM_PARAMS, type GRMItemParams, type MasteryState, pMastery, type RubricScore } from '../schemas/types.js';

// FSRS-4.5 simplified constants
const DECAY = -0.5;
const FACTOR = 19 / 81; // calibrated so R(S, S) = 0.9

/** Power-law forgetting curve. Returns probability of recall at time t (days). */
export function retrievability(t: number, S: number): number {
  if (t <= 0) return 1.0;
  if (S <= 0) return 0.0;
  return (1 + FACTOR * t / S) ** DECAY;
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
  const newS = S * (1 + Math.exp(1.87) * (11 - D) ** 1 * S ** -0.17 * (Math.exp(0.8 * (1 - R)) - 1) * hardPenalty * easyBonus);
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

// ===== GRM (Graded Response Model) with Laplace Approximation =====

// Constants
const EPSILON = 1e-15;
const NR_MAX_ITER = 25;
const NR_TOLERANCE = 1e-6;
const NR_MAX_STEP = 3.0;
const SIGMA_MIN = 0.05;
const SIGMA_MAX = 1.5;

/** Logistic function. */
function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** GRM update result including convergence info. */
export interface GRMUpdateResult {
  mu: number;
  sigma: number;
  converged: boolean;
  iterations: number;
}

/**
 * Boundary Response Function: P*(k | theta) = logistic(a * (theta - b_k))
 * Returns cumulative probabilities for boundaries 1..K (K=3 for 4 categories).
 * By convention P*_0 = 1 and P*_4 = 0.
 */
function brf(theta: number, a: number, b: [number, number, number]): [number, number, number] {
  return [
    logistic(a * (theta - b[0])),
    logistic(a * (theta - b[1])),
    logistic(a * (theta - b[2])),
  ];
}

/**
 * Category probabilities for scores 0, 1, 2, 3.
 * P_0 = 1 - P*_1, P_1 = P*_1 - P*_2, P_2 = P*_2 - P*_3, P_3 = P*_3 - 0
 */
export function grmCategoryProbs(
  theta: number,
  itemParams: GRMItemParams = DEFAULT_GRM_PARAMS,
): [number, number, number, number] {
  const { discrimination: a, thresholds: b } = itemParams;
  const pStar = brf(theta, a, b);

  return [
    Math.max(EPSILON, 1.0 - pStar[0]),
    Math.max(EPSILON, pStar[0] - pStar[1]),
    Math.max(EPSILON, pStar[1] - pStar[2]),
    Math.max(EPSILON, pStar[2]),
  ];
}

/**
 * GRM Bayesian update via Newton-Raphson MAP estimation with Laplace approximation.
 *
 * Finds the MAP estimate of theta given a single observation (score s),
 * a Normal prior N(priorMu, priorSigma^2), and GRM item parameters.
 * Then uses the Hessian curvature at the MAP for the Laplace posterior variance.
 */
export function grmBayesianUpdate(
  score: RubricScore,
  priorMu: number,
  priorSigma: number,
  itemParams: GRMItemParams = DEFAULT_GRM_PARAMS,
): GRMUpdateResult {
  const { discrimination: a, thresholds: b } = itemParams;
  const s = score as number; // 0, 1, 2, 3

  const sigmaEff = Math.max(SIGMA_MIN, Math.min(SIGMA_MAX, priorSigma));
  const sigmaEff2 = sigmaEff * sigmaEff;

  let theta = priorMu;
  let converged = false;
  let iter = 0;

  for (iter = 0; iter < NR_MAX_ITER; iter++) {
    // Compute cumulative boundary probabilities P*_k and their derivatives
    // P*_0 = 1 (implicit), P*_4 = 0 (implicit)
    // For boundaries k=1,2,3:
    const pStar: number[] = [1.0, 0, 0, 0, 0]; // P*_0=1, P*_1, P*_2, P*_3, P*_4=0
    for (let k = 0; k < 3; k++) {
      pStar[k + 1] = logistic(a * (theta - b[k]));
    }
    pStar[4] = 0.0;

    // Category probability for the observed score s
    const Ps = Math.max(EPSILON, pStar[s] - pStar[s + 1]);

    // First derivatives of boundary response functions: Q_k = dP*_k/dtheta = a * P*_k * (1-P*_k)
    const Q: number[] = [0, 0, 0, 0, 0]; // Q_0=0 (d/dtheta of 1 = 0), Q_4=0
    for (let k = 1; k <= 3; k++) {
      Q[k] = a * pStar[k] * (1 - pStar[k]);
    }

    // Second derivatives: R_k = d^2P*_k/dtheta^2 = a^2 * P*_k * (1-P*_k) * (1-2*P*_k)
    const R: number[] = [0, 0, 0, 0, 0];
    for (let k = 1; k <= 3; k++) {
      R[k] = a * a * pStar[k] * (1 - pStar[k]) * (1 - 2 * pStar[k]);
    }

    // Log-likelihood gradient: (Q_s - Q_{s+1}) / P_s
    const llGrad = (Q[s] - Q[s + 1]) / Ps;

    // Log-likelihood hessian: (R_s - R_{s+1})/P_s - [(Q_s - Q_{s+1})/P_s]^2
    const llHess = (R[s] - R[s + 1]) / Ps - llGrad * llGrad;

    // Prior gradient: -(theta - muEff) / sigmaEff^2
    const priorGrad = -(theta - priorMu) / sigmaEff2;

    // Prior hessian: -1 / sigmaEff^2
    const priorHess = -1.0 / sigmaEff2;

    // Total posterior gradient and hessian
    const grad = llGrad + priorGrad;
    const hess = llHess + priorHess;

    // Newton-Raphson step: theta_{n+1} = theta_n - grad/hess
    // hess should be negative (concave posterior)
    if (hess >= 0) {
      // Hessian not negative definite — fall back to gradient step
      break;
    }

    let step = -grad / hess;

    // Damped Newton: clamp step size
    if (Math.abs(step) > NR_MAX_STEP) {
      step = Math.sign(step) * NR_MAX_STEP;
    }

    theta = theta + step;

    if (Math.abs(step) < NR_TOLERANCE) {
      converged = true;
      iter++;
      break;
    }
  }

  // Compute final Hessian at MAP for Laplace approximation
  const pStarFinal: number[] = [1.0, 0, 0, 0, 0];
  for (let k = 0; k < 3; k++) {
    pStarFinal[k + 1] = logistic(a * (theta - b[k]));
  }
  pStarFinal[4] = 0.0;

  const PsFinal = Math.max(EPSILON, pStarFinal[s] - pStarFinal[s + 1]);

  const QFinal: number[] = [0, 0, 0, 0, 0];
  for (let k = 1; k <= 3; k++) {
    QFinal[k] = a * pStarFinal[k] * (1 - pStarFinal[k]);
  }

  const RFinal: number[] = [0, 0, 0, 0, 0];
  for (let k = 1; k <= 3; k++) {
    RFinal[k] = a * a * pStarFinal[k] * (1 - pStarFinal[k]) * (1 - 2 * pStarFinal[k]);
  }

  const llGradFinal = (QFinal[s] - QFinal[s + 1]) / PsFinal;
  const llHessFinal = (RFinal[s] - RFinal[s + 1]) / PsFinal - llGradFinal * llGradFinal;
  const totalHess = llHessFinal + (-1.0 / sigmaEff2);

  // Laplace posterior sigma: sqrt(-1/hessian_at_MAP)
  let postSigma: number;
  if (totalHess >= 0) {
    postSigma = sigmaEff; // fallback
  } else {
    postSigma = Math.sqrt(-1.0 / totalHess);
  }

  // Clamp sigma
  postSigma = Math.max(SIGMA_MIN, Math.min(SIGMA_MAX, postSigma));

  return {
    mu: theta,
    sigma: postSigma,
    converged,
    iterations: iter,
  };
}

/**
 * Drop-in GRM wrapper that takes and returns MasteryState.
 * Replaces bayesianUpdate for callers that want the full GRM model.
 */
export function grmUpdate(
  mastery: MasteryState,
  score: RubricScore,
  itemParams: GRMItemParams = DEFAULT_GRM_PARAMS,
): MasteryState {
  const result = grmBayesianUpdate(score, mastery.mu, mastery.sigma, itemParams);
  return { mu: result.mu, sigma: result.sigma };
}

/**
 * Expected Fisher information at theta for a GRM item.
 * I(theta) = sum_{k=0..3} (dP_k/dtheta)^2 / P_k
 *
 * Where dP_k/dtheta = Q_k - Q_{k+1} (difference of boundary derivatives).
 */
export function grmFisherInformation(
  theta: number,
  itemParams: GRMItemParams = DEFAULT_GRM_PARAMS,
): number {
  const { discrimination: a, thresholds: b } = itemParams;

  // Cumulative boundary probabilities
  const pStar = [1.0, 0, 0, 0, 0]; // P*_0=1, ..., P*_4=0
  for (let k = 0; k < 3; k++) {
    pStar[k + 1] = logistic(a * (theta - b[k]));
  }
  pStar[4] = 0.0;

  // Boundary first derivatives: Q_k = a * P*_k * (1-P*_k)
  const Q = [0, 0, 0, 0, 0]; // Q_0=0, Q_4=0
  for (let k = 1; k <= 3; k++) {
    Q[k] = a * pStar[k] * (1 - pStar[k]);
  }

  // Fisher info: sum over categories k=0..3 of (dP_k/dtheta)^2 / P_k
  // dP_k/dtheta = Q_k - Q_{k+1}
  let info = 0;
  for (let k = 0; k <= 3; k++) {
    const Pk = Math.max(EPSILON, pStar[k] - pStar[k + 1]);
    const dPk = Q[k] - Q[k + 1];
    info += (dPk * dPk) / Pk;
  }

  return info;
}
