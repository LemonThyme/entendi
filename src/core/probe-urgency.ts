import { pMastery } from '../schemas/types.js';
import { retrievability } from './probabilistic-model.js';

export interface ProbeUrgencyInput {
  mu: number;
  sigma: number;
  stability: number;
  daysSinceAssessed: number;
  assessmentCount: number;
  fisherInfo: number;
}

// Weights for the urgency formula (from Issue #6)
const W_MASTERY = 0.3;    // weight for (1 - pMastery) — lower mastery = more urgent
const W_VARIANCE = 0.4;   // weight for uncertainty — high sigma = more urgent
const W_DECAY = 0.3;      // weight for (1 - retrievability) — stale = more urgent

const SIGMA_MAX = 1.5;    // max sigma (initial prior)

/**
 * Compute probe urgency for a concept.
 * Returns a value in [0, 1] where higher = more urgent to probe.
 *
 * probeUrgency = (1 - pMastery) * w1 + normalizedVariance * w2 + (1 - R) * w3
 *
 * This distinguishes four states from Issue #6:
 * - Expert (high mastery, low sigma): low urgency
 * - Lucky guess (high mastery, high sigma): high urgency (sigma dominates)
 * - Struggling (low mastery, low sigma): moderate urgency
 * - Unknown (prior mastery, high sigma): highest urgency
 */
export function probeUrgency(input: ProbeUrgencyInput): number {
  const { mu, sigma, stability, daysSinceAssessed, assessmentCount } = input;

  // Component 1: mastery gap (1 - pMastery)
  const masteryGap = 1 - pMastery(mu);

  // Component 2: normalized variance (sigma / SIGMA_MAX), clamped to [0, 1]
  const normalizedVariance = Math.min(1.0, sigma / SIGMA_MAX);

  // Component 3: knowledge decay (1 - retrievability)
  let decayFactor: number;
  if (assessmentCount === 0) {
    // Never assessed — treat as fully decayed
    decayFactor = 1.0;
  } else {
    const R = retrievability(daysSinceAssessed, stability);
    decayFactor = 1 - R;
  }

  const urgency = W_MASTERY * masteryGap + W_VARIANCE * normalizedVariance + W_DECAY * decayFactor;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, urgency));
}
