import type { StateManager } from '../../core/state-manager.js';
import type { RubricScore, TutorPhase } from '../../schemas/types.js';
import { createTutorSession, createTutorExchange, pMastery } from '../../schemas/types.js';
import { advanceTutorPhase, isPhaseScored } from '../../core/tutor-session.js';
import { loadConfig, type ResolvedConfig } from '../../config/config-loader.js';
import { writePendingAction, clearPendingAction } from '../pending-action.js';
import { applyBayesianUpdate } from './shared-update.js';

// --- Public types ---

export interface StartTutorInput {
  conceptId: string;
  triggerScore?: 0 | 1 | null;
}

export interface StartTutorResult {
  sessionId: string;
  phase: 'phase1';
  guidance: string;
  prerequisiteSuggestion?: string;
}

export interface AdvanceTutorInput {
  sessionId: string;
  userResponse: string;
  score?: 0 | 1 | 2 | 3;
  confidence?: number;
  reasoning?: string;
  misconception?: string;
}

export interface AdvanceTutorResult {
  phase: string;
  isComplete: boolean;
  guidance?: string;
  masteryUpdate?: { before: number; after: number };
  sessionSummary?: string;
}

export interface DismissInput {
  reason?: 'user_declined' | 'topic_changed' | 'timeout';
}

export interface DismissResult {
  acknowledged: true;
}

// --- Phase guidance generators ---

function getPhaseGuidance(phase: TutorPhase, conceptId: string, misconception?: string | null): string {
  switch (phase) {
    case 'phase1':
      return `Assess what the user already knows about ${conceptId}. Ask an open-ended question about their understanding.`;
    case 'phase2':
      return `Guide them toward deeper understanding of ${conceptId}. Identify gaps from their phase1 answer.`;
    case 'phase3':
      if (misconception) {
        return `Address the misconception: "${misconception}". Help the user correct their understanding of ${conceptId}.`;
      }
      return `Deepen understanding of ${conceptId}. Address any remaining gaps or misconceptions.`;
    case 'phase4':
      return `Ask for a comprehensive explanation of ${conceptId}. This is the final assessment.`;
    default:
      return '';
  }
}

// --- handleStartTutor ---

export function handleStartTutor(
  input: StartTutorInput,
  sm: StateManager,
  userId: string,
  config?: ResolvedConfig,
): StartTutorResult {
  const { conceptId, triggerScore } = input;

  // 1. Create a TutorSession
  const triggerRubric = triggerScore === undefined ? null : triggerScore as RubricScore | null;
  const session = createTutorSession(conceptId, triggerRubric);

  // 2. Advance from 'offered' to 'phase1'
  const activeSession = advanceTutorPhase(session);

  // 3. Check ZPD prerequisites
  const kg = sm.getKnowledgeGraph();
  const concept = kg.getConcept(conceptId);
  let prerequisiteSuggestion: string | undefined;

  if (concept) {
    const prereqs = concept.relationships.filter(r => r.type === 'requires');
    const resolvedConfig = config ?? loadConfig(sm.getDataDir());
    const threshold = resolvedConfig.orgPolicy.masteryThreshold;

    const unmasteredPrereqs = prereqs.filter(r => {
      const prereqState = kg.getUserConceptState(userId, r.target);
      return pMastery(prereqState.mastery.mu) < threshold;
    });

    if (unmasteredPrereqs.length > 0) {
      const prereqIds = unmasteredPrereqs.map(r => r.target).join(', ');
      prerequisiteSuggestion = `Consider teaching ${prereqIds} first — these prerequisites are not yet mastered.`;
    }
  }

  // 4. Generate phase-specific guidance
  const guidance = getPhaseGuidance('phase1', conceptId);

  // 5. Write tutor_active pending action
  writePendingAction(sm.getDataDir(), {
    type: 'tutor_active',
    sessionId: activeSession.sessionId,
    conceptId,
    phase: activeSession.phase,
    timestamp: new Date().toISOString(),
  });

  // 6. Save tutor session to state manager
  sm.setTutorSession(activeSession);
  sm.save();

  // 7. Return result
  const result: StartTutorResult = {
    sessionId: activeSession.sessionId,
    phase: 'phase1',
    guidance,
  };

  if (prerequisiteSuggestion) {
    result.prerequisiteSuggestion = prerequisiteSuggestion;
  }

  return result;
}

// --- handleAdvanceTutor ---

export function handleAdvanceTutor(
  input: AdvanceTutorInput,
  sm: StateManager,
  userId: string,
  config?: ResolvedConfig,
): AdvanceTutorResult {
  const resolvedConfig = config ?? loadConfig(sm.getDataDir());
  const { sessionId, userResponse, score, confidence, reasoning, misconception } = input;

  // 1. Load tutor session
  const session = sm.getTutorSession();
  if (!session || session.sessionId !== sessionId) {
    throw new Error(`No active tutor session with id ${sessionId}`);
  }

  const currentPhase = session.phase;
  let masteryUpdate: { before: number; after: number } | undefined;

  // 2. Record the user's response as an exchange
  const exchange = createTutorExchange(currentPhase, '');
  exchange.response = userResponse;
  session.exchanges.push(exchange);
  session.lastActivityAt = new Date().toISOString();

  // 3. If current phase is scored, do Bayesian update
  if (isPhaseScored(currentPhase) && score !== undefined) {
    const eventType = currentPhase === 'phase1' ? 'tutor_phase1' as const : 'tutor_phase4' as const;
    const updateResult = applyBayesianUpdate(sm, userId, {
      conceptId: session.conceptId,
      score: score as RubricScore,
      confidence: confidence ?? 0.5,
      reasoning: reasoning ?? '',
      eventType,
    }, resolvedConfig);
    masteryUpdate = { before: updateResult.previousMastery, after: updateResult.newMastery };

    // Record phase score on the session
    if (currentPhase === 'phase1') {
      session.phase1Score = score as RubricScore;
    } else if (currentPhase === 'phase4') {
      session.phase4Score = score as RubricScore;
    }
  }

  // 4. Store misconception if provided
  if (misconception) {
    session.lastMisconception = misconception;
  }

  // 5. Advance phase
  const advancedSession = advanceTutorPhase(session);
  const nextPhase = advancedSession.phase;

  // 6. Handle completion vs ongoing
  if (nextPhase === 'complete') {
    // Generate session summary
    const p1Score = advancedSession.phase1Score !== null ? advancedSession.phase1Score : 'N/A';
    const p4Score = advancedSession.phase4Score !== null ? advancedSession.phase4Score : 'N/A';
    const masteryStr = masteryUpdate
      ? ` Mastery changed from ${(masteryUpdate.before * 100).toFixed(1)}% to ${(masteryUpdate.after * 100).toFixed(1)}%.`
      : '';
    const sessionSummary = `Tutor session for ${advancedSession.conceptId} complete. Phase 1 score: ${p1Score}/3, Phase 4 score: ${p4Score}/3.${masteryStr}`;

    // Clear tutor session and pending action
    sm.clearTutorSession();
    clearPendingAction(sm.getDataDir());
    sm.save();

    return {
      phase: 'complete',
      isComplete: true,
      sessionSummary,
      masteryUpdate,
    };
  }

  // 7. Generate guidance for next phase
  const guidance = getPhaseGuidance(nextPhase, advancedSession.conceptId, advancedSession.lastMisconception);

  // 8. Update pending action
  writePendingAction(sm.getDataDir(), {
    type: 'tutor_active',
    sessionId: advancedSession.sessionId,
    conceptId: advancedSession.conceptId,
    phase: nextPhase,
    timestamp: new Date().toISOString(),
  });

  // 9. Save state
  sm.setTutorSession(advancedSession);
  sm.save();

  return {
    phase: nextPhase,
    isComplete: false,
    guidance,
    masteryUpdate,
  };
}

// --- handleDismiss ---

export function handleDismiss(
  input: DismissInput,
  sm: StateManager,
  userId: string,
  dataDir?: string,
): DismissResult {
  const resolvedDataDir = dataDir ?? sm.getDataDir();

  // 1. Clear pending probe from probe session
  sm.clearPendingProbe();

  // 2. Clear tutor session
  sm.clearTutorSession();

  // 3. Clear pending action file
  clearPendingAction(resolvedDataDir);

  // 4. Save state
  sm.save();

  return { acknowledged: true };
}
