export interface ProbeCandidate {
  conceptId: string;
  mu: number;
  sigma: number;
  fisherInfo: number;
  urgency: number; // kept for backward compat / logging
}

/**
 * Expected information gain from probing a concept.
 * Approximated as posterior variance reduction via Fisher information.
 *
 * infoGain = sigma^2 - 1/(1/sigma^2 + fisherInfo)
 *
 * Higher when: sigma is large (uncertain) AND Fisher info is high
 * (the probe question is discriminating at this ability level).
 */
export function expectedInfoGain(sigma: number, fisherInfo: number): number {
  if (sigma === 0 || fisherInfo === 0) return 0;
  const priorVariance = sigma * sigma;
  const posteriorVariance = 1 / (1 / priorVariance + fisherInfo);
  return priorVariance - posteriorVariance;
}

/**
 * Select the best concept to probe using information-theoretic selection
 * weighted by conversational relevance.
 *
 * When `primaryConceptId` is provided and matches a candidate with positive
 * expected information gain, that concept is selected directly — the user is
 * actively discussing it, so it takes priority over pure info-gain ranking.
 *
 * Otherwise falls back to:
 *   score(c) = infoGain(c) * relevance(c)
 *
 * relevance(c) = 1 / (1 + embeddingDistance(c, trunk))
 *   where embeddingDistance = 1 - cosineSimilarity
 *
 * When no trunk concept is specified (hasTrunk=false), relevance = 1.0 for
 * all candidates (degrades to pure info-gain selection).
 */
export function selectProbeCandidate(
  candidates: ProbeCandidate[],
  similarities: Map<string, number>,
  hasTrunk: boolean,
  primaryConceptId?: string,
): { selected: ProbeCandidate; score: number } | null {
  if (candidates.length === 0) return null;

  // Direct preference: if primaryConceptId matches a candidate with positive
  // info-gain, select it — the user is actively discussing this concept.
  if (primaryConceptId) {
    const primary = candidates.find(c => c.conceptId === primaryConceptId);
    if (primary) {
      const infoGain = expectedInfoGain(primary.sigma, primary.fisherInfo);
      if (infoGain > 0) {
        return { selected: primary, score: infoGain };
      }
    }
  }

  let best: ProbeCandidate | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    const infoGain = expectedInfoGain(c.sigma, c.fisherInfo);

    let relevance = 1.0;
    if (hasTrunk) {
      const similarity = similarities.get(c.conceptId) ?? 0;
      const distance = 1 - similarity;
      relevance = 1 / (1 + distance);
    }

    const score = infoGain * relevance;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best ? { selected: best, score: bestScore } : null;
}
