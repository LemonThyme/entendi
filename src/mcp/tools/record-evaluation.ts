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
import { shouldOfferTutor } from '../../core/tutor-session.js';
import { loadConfig, type ResolvedConfig } from '../../config/config-loader.js';
import { clearPendingAction, writePendingAction } from '../pending-action.js';

// --- Public types ---

export interface RecordEvaluationInput {
  conceptId: string;
  score: 0 | 1 | 2 | 3;
  confidence: number;
  reasoning: string;
  eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
}

export interface RecordEvaluationOutput {
  mastery: number;           // P(mastery) after update
  previousMastery: number;
  shouldOfferTutor: boolean;
  message?: string;
}

// --- Main handler ---

export function handleRecordEvaluation(
  input: RecordEvaluationInput,
  sm: StateManager,
  userId: string,
  config?: ResolvedConfig,
): RecordEvaluationOutput {
  const resolvedConfig = config ?? loadConfig(sm.getDataDir());
  const kg = sm.getKnowledgeGraph();
  const { conceptId, score, confidence, reasoning, eventType } = input;

  // 1. Get user concept state
  const ucs = kg.getUserConceptState(userId, conceptId);

  // Record previous mastery
  const previousMastery = pMastery(ucs.mastery.mu);

  // 2. Apply time decay to mastery
  let currentMastery = ucs.mastery;
  let R = 1.0;
  if (ucs.lastAssessed) {
    const elapsedDays = (Date.now() - new Date(ucs.lastAssessed).getTime()) / (1000 * 60 * 60 * 24);
    R = retrievability(elapsedDays, ucs.memory.stability);
    currentMastery = decayPrior(currentMastery.mu, currentMastery.sigma, R);
  }

  // 3. GRM Bayesian update
  const muBefore = currentMastery.mu;
  const concept = kg.getConcept(conceptId);
  const updatedMastery = grmUpdate(currentMastery, score as RubricScore, concept?.itemParams);

  // 4. FSRS memory update
  const fsrsGrade = mapRubricToFsrsGrade(score as RubricScore);
  let newStability = ucs.memory.stability;
  let newDifficulty = ucs.memory.difficulty;
  if (fsrsGrade >= 2) {
    newStability = fsrsStabilityAfterSuccess(ucs.memory.stability, ucs.memory.difficulty, R, fsrsGrade);
  }
  newDifficulty = fsrsDifficultyUpdate(ucs.memory.difficulty, fsrsGrade);

  // 5. Record AssessmentEvent
  const isTutored = eventType === 'tutor_phase4';
  const probeDepth: 0 | 1 | 2 | 3 = eventType === 'probe' ? 1
    : eventType === 'tutor_phase1' ? 1
    : 3; // tutor_phase4

  const event: AssessmentEvent = {
    timestamp: new Date().toISOString(),
    eventType,
    rubricScore: score as RubricScore,
    evaluatorConfidence: confidence,
    muBefore,
    muAfter: updatedMastery.mu,
    probeDepth,
    tutored: isTutored,
  };

  // 6. Counterfactual tracking
  if (isTutored) {
    // tutor_phase4: attenuated update to primary mastery, NO shadow update
    const weight = resolvedConfig.orgPolicy.tutoredEvidenceWeight;
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

  // Update memory, timestamp, assessment count, and history
  ucs.memory = { stability: newStability, difficulty: newDifficulty };
  ucs.lastAssessed = new Date().toISOString();
  ucs.assessmentCount += 1;
  ucs.history.push(event);

  // Persist updated user concept state
  kg.setUserConceptState(userId, conceptId, ucs);

  // 7. Check shouldOfferTutor (only for probe events)
  let offerTutor = false;
  if (eventType === 'probe') {
    offerTutor = shouldOfferTutor(
      score as RubricScore,
      resolvedConfig.orgPolicy.tutorTriggerThreshold,
      resolvedConfig.orgPolicy.tutorMode,
    );
  }

  // 8. Clear pending action (probe is resolved)
  clearPendingAction(sm.getDataDir());

  // 9. If shouldOfferTutor, write new pending action with tutor_offered
  if (offerTutor) {
    writePendingAction(sm.getDataDir(), {
      type: 'tutor_offered',
      conceptId,
      triggerScore: score,
      timestamp: new Date().toISOString(),
    });
  }

  // 10. Save state
  sm.save();

  // 11. Compute result mastery and build message
  const newMasteryProb = pMastery(ucs.mastery.mu);
  const direction = newMasteryProb > previousMastery ? 'improved' : newMasteryProb < previousMastery ? 'decreased' : 'unchanged';
  const message = `Mastery ${direction} from ${(previousMastery * 100).toFixed(1)}% to ${(newMasteryProb * 100).toFixed(1)}%`;

  return {
    mastery: newMasteryProb,
    previousMastery,
    shouldOfferTutor: offerTutor,
    message,
  };
}
