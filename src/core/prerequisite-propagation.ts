/**
 * Prerequisite propagation (Design Doc Section 5.5)
 *
 * When mastery of concept C improves, propagate a prior boost to concepts
 * that DEPEND ON C (i.e., concepts for which C is a prerequisite).
 *
 * Only positive updates propagate forward (mastery gains, not failures).
 * Boost is attenuated to prevent runaway propagation.
 */

export interface PropagationTarget {
  conceptId: string;
  mu: number;
  sigma: number;
}

export interface PropagationInput {
  muBefore: number;
  muAfter: number;
  targets: PropagationTarget[];
}

export interface PropagationResult {
  conceptId: string;
  newMu: number;
  boost: number;
}

// Boost factor from design doc: boost = 0.3 / depth (depth=1 for direct dependents)
const BOOST_FACTOR = 0.3;

/**
 * Compute prior boosts for dependent concepts after a prerequisite's mastery improves.
 *
 * From design doc Section 5.5:
 *   mu_s += boost * max(0, mu_c_posterior - mu_c_prior)
 *
 * Returns array of concepts with updated mu values.
 * Returns empty array if mastery didn't improve (no forward propagation of failure).
 */
export function propagatePrerequisiteBoost(input: PropagationInput): PropagationResult[] {
  const { muBefore, muAfter, targets } = input;

  const gain = muAfter - muBefore;

  // Only propagate positive updates
  if (gain <= 0 || targets.length === 0) {
    return [];
  }

  return targets.map(target => {
    const boost = BOOST_FACTOR * gain;
    return {
      conceptId: target.conceptId,
      newMu: target.mu + boost,
      boost,
    };
  });
}
