// src/core/anomaly-detection.ts

export interface AnomalyInput {
  recentScores: number[];         // last N probe scores for this user
  historicalScores: number[];     // all-time probe scores for this user
  populationScoresForConcepts: Record<string, number[]>; // concept -> all users' scores
  userScoresForConcepts: Record<string, number[]>;       // concept -> this user's scores
  dismissCount: number;
  probeCount: number;
  recentMasteryChanges: number[]; // delta pMastery per assessment
  populationMasteryVelocity: { mean: number; std: number };
}

export interface AnomalySignals {
  zSelf: number;
  zPopulation: number;
  dismissRatio: number;
  masteryVelocity: number;
  compositeScore: number;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1));
}

export function computeAnomalySignals(input: AnomalyInput): AnomalySignals {
  // z_self: recent scores vs historical baseline
  let zSelf = 0;
  if (input.historicalScores.length >= 3 && input.recentScores.length >= 1) {
    const histMean = mean(input.historicalScores);
    const histStd = std(input.historicalScores);
    if (histStd > 0) {
      zSelf = (mean(input.recentScores) - histMean) / histStd;
    }
  }

  // z_population: user's concept scores vs population scores
  let zPopulation = 0;
  const conceptZScores: number[] = [];
  for (const [conceptId, userScores] of Object.entries(input.userScoresForConcepts)) {
    const popScores = input.populationScoresForConcepts[conceptId];
    if (popScores && popScores.length >= 3 && userScores.length >= 1) {
      const popMean = mean(popScores);
      const popStd = std(popScores);
      if (popStd > 0) {
        conceptZScores.push((mean(userScores) - popMean) / popStd);
      }
    }
  }
  if (conceptZScores.length > 0) {
    zPopulation = mean(conceptZScores);
  }

  // dismiss ratio
  const dismissRatio = input.probeCount > 0
    ? input.dismissCount / input.probeCount
    : 0;

  // mastery velocity z-score
  let masteryVelocity = 0;
  if (input.recentMasteryChanges.length > 0 && input.populationMasteryVelocity.std > 0) {
    const userVelocity = mean(input.recentMasteryChanges);
    masteryVelocity = (userVelocity - input.populationMasteryVelocity.mean)
      / input.populationMasteryVelocity.std;
  }

  // composite: weighted combination (all positive = more suspicious)
  const compositeScore = Math.max(0,
    0.3 * Math.max(0, zSelf) +
    0.3 * Math.max(0, zPopulation) +
    0.2 * dismissRatio +
    0.2 * Math.max(0, masteryVelocity)
  );

  return { zSelf, zPopulation, dismissRatio, masteryVelocity, compositeScore };
}
