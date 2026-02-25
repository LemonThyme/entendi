import type { NoveltyLevel } from '../schemas/types.js';
import { retrievability } from './probabilistic-model.js';

const PROBE_PROBABILITIES: Record<NoveltyLevel, number> = {
  routine: 0.05,
  adjacent: 0.25,
  novel: 0.60,
  critical: 0.80,
};

/** Decide whether to probe based on novelty level. */
export function shouldProbe(novelty: NoveltyLevel, force?: boolean): boolean {
  if (force) return true;
  return Math.random() < PROBE_PROBABILITIES[novelty];
}

interface ProbeCandidateInfo {
  conceptId: string;
  mu: number;
  sigma: number;
  daysSinceAssessment: number;
}

/** Select the concept to probe by maximizing information value. */
export function selectConceptToProbe(candidates: ProbeCandidateInfo[]): string | null {
  if (candidates.length === 0) return null;

  let bestId: string | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    const uncertainty = c.sigma * c.sigma;
    const R = retrievability(c.daysSinceAssessment, Math.max(c.sigma * 10, 1));
    const decayBonus = 1 - R;
    const score = uncertainty + decayBonus;

    if (score > bestScore) {
      bestScore = score;
      bestId = c.conceptId;
    }
  }

  return bestId;
}
