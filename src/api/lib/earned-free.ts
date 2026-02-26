/**
 * Earned free tier evaluation.
 * Users who demonstrate strong mastery earn temporary Pro access.
 */

export interface MasteryStats {
  totalConcepts: number;
  masteredConcepts: number; // concepts with mu >= masteryThreshold
}

const MIN_CONCEPTS = 10;
const MASTERY_THRESHOLD = 0.8; // mu value considered "mastered"
const EARNED_FREE_DURATION_DAYS = 14;

/**
 * Check if a user qualifies for earned free tier.
 * Requires >= 10 tracked concepts with 80%+ having mu >= 0.8.
 */
export function shouldGrantEarnedFree(stats: MasteryStats): boolean {
  if (stats.totalConcepts < MIN_CONCEPTS) return false;
  const ratio = stats.masteredConcepts / stats.totalConcepts;
  return ratio >= MASTERY_THRESHOLD;
}

/**
 * Get the expiry date for earned free tier (2 weeks from now).
 */
export function getEarnedFreeExpiry(from: Date = new Date()): Date {
  const expiry = new Date(from);
  expiry.setDate(expiry.getDate() + EARNED_FREE_DURATION_DAYS);
  return expiry;
}

/**
 * The mu threshold at which a concept is considered "mastered".
 */
export function getMasteryThreshold(): number {
  return MASTERY_THRESHOLD;
}

/**
 * The minimum number of concepts needed to qualify.
 */
export function getMinConcepts(): number {
  return MIN_CONCEPTS;
}
