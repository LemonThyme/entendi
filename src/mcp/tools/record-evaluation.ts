import type { StateManager } from '../../core/state-manager.js';
import type { RubricScore } from '../../schemas/types.js';
import { shouldOfferTutor } from '../../core/tutor-session.js';
import { loadConfig, type ResolvedConfig } from '../../config/config-loader.js';
import { clearPendingAction, writePendingAction } from '../pending-action.js';
import { applyBayesianUpdate } from './shared-update.js';

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
  const { conceptId, score, confidence, reasoning, eventType } = input;

  // 1. Perform Bayesian update (time decay, GRM, FSRS, counterfactual tracking)
  const { previousMastery, newMastery } = applyBayesianUpdate(sm, userId, {
    conceptId,
    score: score as RubricScore,
    confidence,
    reasoning,
    eventType,
  }, resolvedConfig);

  // 2. Check shouldOfferTutor (only for probe events)
  let offerTutor = false;
  if (eventType === 'probe') {
    offerTutor = shouldOfferTutor(
      score as RubricScore,
      resolvedConfig.orgPolicy.tutorTriggerThreshold,
      resolvedConfig.orgPolicy.tutorMode,
    );
  }

  // 3. Clear pending action (probe is resolved)
  clearPendingAction(sm.getDataDir());

  // 4. If shouldOfferTutor, write new pending action with tutor_offered
  if (offerTutor) {
    writePendingAction(sm.getDataDir(), {
      type: 'tutor_offered',
      conceptId,
      triggerScore: score,
      timestamp: new Date().toISOString(),
    });
  }

  // 5. Save state
  sm.save();

  // 6. Compute result and build message
  const direction = newMastery > previousMastery ? 'improved' : newMastery < previousMastery ? 'decreased' : 'unchanged';
  const message = `Mastery ${direction} from ${(previousMastery * 100).toFixed(1)}% to ${(newMastery * 100).toFixed(1)}%`;

  return {
    mastery: newMastery,
    previousMastery,
    shouldOfferTutor: offerTutor,
    message,
  };
}
