import type { StateManager } from '../../core/state-manager.js';
import type { RubricScore, AssessmentEvent } from '../../schemas/types.js';
import { pMastery } from '../../schemas/types.js';
import {
  grmUpdate,
  mapRubricToFsrsGrade,
  fsrsStabilityAfterSuccess,
  fsrsDifficultyUpdate,
  retrievability,
  decayPrior,
} from '../../core/probabilistic-model.js';
import type { ResolvedConfig } from '../../config/config-loader.js';

// --- Public types ---

export interface BayesianUpdateInput {
  conceptId: string;
  score: RubricScore;
  confidence: number;
  reasoning: string;
  eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
}

export interface BayesianUpdateResult {
  previousMastery: number;  // P(mastery) before update
  newMastery: number;       // P(mastery) after update
}

/**
 * Shared Bayesian update function used by both record-evaluation and tutor tools.
 *
 * Performs: time decay, GRM update, FSRS update, AssessmentEvent recording,
 * and counterfactual tracking (attenuated for tutored, full for untutored).
 *
 * Mutates the UserConceptState in-place on the knowledge graph and persists
 * it via kg.setUserConceptState. Caller is responsible for calling sm.save().
 */
export function applyBayesianUpdate(
  sm: StateManager,
  userId: string,
  input: BayesianUpdateInput,
  config: ResolvedConfig,
): BayesianUpdateResult {
  const { conceptId, score, confidence, eventType } = input;
  const kg = sm.getKnowledgeGraph();
  const ucs = kg.getUserConceptState(userId, conceptId);

  // Record previous mastery
  const previousMastery = pMastery(ucs.mastery.mu);

  // 1. Apply time decay to mastery
  let currentMastery = ucs.mastery;
  let R = 1.0;
  if (ucs.lastAssessed) {
    const elapsedDays = (Date.now() - new Date(ucs.lastAssessed).getTime()) / (1000 * 60 * 60 * 24);
    R = retrievability(elapsedDays, ucs.memory.stability);
    currentMastery = decayPrior(currentMastery.mu, currentMastery.sigma, R);
  }

  // 2. GRM Bayesian update
  const muBefore = currentMastery.mu;
  const concept = kg.getConcept(conceptId);
  const updatedMastery = grmUpdate(currentMastery, score, concept?.itemParams);

  // 3. FSRS memory update
  const fsrsGrade = mapRubricToFsrsGrade(score);
  let newStability = ucs.memory.stability;
  let newDifficulty = ucs.memory.difficulty;
  if (fsrsGrade >= 2) {
    newStability = fsrsStabilityAfterSuccess(ucs.memory.stability, ucs.memory.difficulty, R, fsrsGrade);
  }
  newDifficulty = fsrsDifficultyUpdate(ucs.memory.difficulty, fsrsGrade);

  // 4. Record AssessmentEvent
  const isTutored = eventType === 'tutor_phase4';
  const probeDepth: 0 | 1 | 2 | 3 = eventType === 'probe' ? 1
    : eventType === 'tutor_phase1' ? 1
    : 3; // tutor_phase4

  const event: AssessmentEvent = {
    timestamp: new Date().toISOString(),
    eventType,
    rubricScore: score,
    evaluatorConfidence: confidence,
    muBefore,
    muAfter: updatedMastery.mu,
    probeDepth,
    tutored: isTutored,
  };

  // 5. Counterfactual tracking
  if (isTutored) {
    // tutor_phase4: attenuated update to primary mastery, NO shadow update
    const weight = config.orgPolicy.tutoredEvidenceWeight;
    ucs.mastery = {
      mu: currentMastery.mu + weight * (updatedMastery.mu - currentMastery.mu),
      sigma: currentMastery.sigma + weight * (updatedMastery.sigma - currentMastery.sigma),
    };
    ucs.tutoredAssessmentCount += 1;
  } else {
    // probe or tutor_phase1: full update to primary AND shadow
    ucs.mastery = updatedMastery;
    ucs.muUntutored = updatedMastery.mu;
    ucs.sigmaUntutored = updatedMastery.sigma;
    ucs.untutoredAssessmentCount += 1;
  }

  // 6. Update memory, timestamp, assessment count, and history
  ucs.memory = { stability: newStability, difficulty: newDifficulty };
  ucs.lastAssessed = new Date().toISOString();
  ucs.assessmentCount += 1;
  ucs.history.push(event);

  // 7. Persist updated user concept state
  kg.setUserConceptState(userId, conceptId, ucs);

  const newMastery = pMastery(ucs.mastery.mu);
  return { previousMastery, newMastery };
}
