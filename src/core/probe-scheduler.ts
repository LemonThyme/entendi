import type { GRMItemParams, NoveltyLevel } from '../schemas/types.js';
import { grmFisherInformation, retrievability } from './probabilistic-model.js';

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

export interface ProbeCandidateInfo {
  conceptId: string;
  mu: number;
  sigma: number;
  stability: number;
  daysSinceAssessment: number;
  itemParams: GRMItemParams;
}

/** Select the concept to probe by maximizing information value.
 *  Uses GRM Fisher information weighted by memory decay bonus. */
export function selectConceptToProbe(candidates: ProbeCandidateInfo[]): string | null {
  if (candidates.length === 0) return null;

  let bestId: string | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    const fisherInfo = grmFisherInformation(c.mu, c.itemParams);
    const R = retrievability(c.daysSinceAssessment, c.stability);
    const decayBonus = 1 - R;
    const score = fisherInfo * (1 + decayBonus);

    if (score > bestScore) {
      bestScore = score;
      bestId = c.conceptId;
    }
  }

  return bestId;
}
