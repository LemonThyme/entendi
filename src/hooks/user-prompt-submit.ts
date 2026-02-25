import { readStdin, getDataDir, getUserId, type HookInput } from './shared.js';
import { StateManager } from '../core/state-manager.js';
import { evaluateResponse } from '../core/probe-engine.js';
import {
  bayesianUpdate,
  mapRubricToFsrsGrade,
  fsrsStabilityAfterSuccess,
  fsrsDifficultyUpdate,
  retrievability,
  decayPrior,
} from '../core/probabilistic-model.js';
import type { RubricScore, ProbeEvaluation, AssessmentEvent } from '../schemas/types.js';

export interface UserPromptSubmitOutput {
  hookSpecificOutput?: {
    additionalContext?: string;
  };
}

interface UserPromptSubmitOptions {
  dataDir?: string;
  skipLLM?: boolean;
  userId?: string;
}

export async function handleUserPromptSubmit(
  input: HookInput,
  options: UserPromptSubmitOptions = {},
): Promise<UserPromptSubmitOutput | null> {
  const { skipLLM = false } = options;
  const dataDir = options.dataDir ?? getDataDir(input.cwd);
  const userId = options.userId ?? getUserId();

  // 1. Load state
  const sm = new StateManager(dataDir, userId);

  // 2. Check for pending probe
  const pendingProbe = sm.getProbeSession().pendingProbe;
  if (!pendingProbe) return null;

  const { probe, triggerContext } = pendingProbe;
  const userResponse = (input.prompt as string) ?? '';

  // 3. Evaluate the response
  let evaluation: ProbeEvaluation;

  if (skipLLM) {
    // Default fallback evaluation: Surface level with moderate confidence
    evaluation = {
      rubricScore: 1 as RubricScore,
      confidence: 0.5,
      reasoning: 'Default evaluation (LLM skipped)',
      suggestFollowup: false,
      misconceptionDetected: null,
    };
  } else {
    evaluation = await evaluateResponse({
      question: probe.question,
      response: userResponse,
      conceptName: probe.conceptId,
      depth: probe.depth,
    });
  }

  // 4. Get or create the user concept state
  const kg = sm.getKnowledgeGraph();
  const ucs = kg.getUserConceptState(userId, probe.conceptId);

  // 5. Apply time decay to mastery
  let currentMastery = ucs.mastery;
  let R = 1.0;
  if (ucs.lastAssessed) {
    const elapsedDays = (Date.now() - new Date(ucs.lastAssessed).getTime()) / (1000 * 60 * 60 * 24);
    R = retrievability(elapsedDays, ucs.memory.stability);
    currentMastery = decayPrior(currentMastery.mu, currentMastery.sigma, R);
  }

  // 6. Bayesian update with the rubric score
  const muBefore = currentMastery.mu;
  const updatedMastery = bayesianUpdate(currentMastery, evaluation.rubricScore);

  // 7. Update FSRS stability and difficulty
  const fsrsGrade = mapRubricToFsrsGrade(evaluation.rubricScore);
  let newStability = ucs.memory.stability;
  let newDifficulty = ucs.memory.difficulty;

  if (fsrsGrade >= 2) {
    // Successful recall
    newStability = fsrsStabilityAfterSuccess(ucs.memory.stability, ucs.memory.difficulty, R, fsrsGrade);
  }
  newDifficulty = fsrsDifficultyUpdate(ucs.memory.difficulty, fsrsGrade);

  // 8. Record the assessment event
  const event: AssessmentEvent = {
    timestamp: new Date().toISOString(),
    eventType: 'probe',
    rubricScore: evaluation.rubricScore,
    evaluatorConfidence: evaluation.confidence,
    muBefore,
    muAfter: updatedMastery.mu,
    probeDepth: probe.depth,
    tutored: false,
  };

  // 9. Update the user concept state
  ucs.mastery = updatedMastery;
  ucs.memory = { stability: newStability, difficulty: newDifficulty };
  ucs.lastAssessed = new Date().toISOString();
  ucs.assessmentCount += 1;
  ucs.history.push(event);

  kg.setUserConceptState(userId, probe.conceptId, ucs);

  // 10. Clear the pending probe
  sm.clearPendingProbe();

  // 11. Save state
  sm.save();

  // 12. Return additionalContext with evaluation summary
  const scoreLabel = ['No understanding', 'Surface', 'Functional', 'Deep'][evaluation.rubricScore];

  return {
    hookSpecificOutput: {
      additionalContext: `[Entendi] Comprehension check on "${probe.conceptId}" — Score: ${evaluation.rubricScore}/3 (${scoreLabel}). ${evaluation.reasoning}`,
    },
  };
}

async function main() {
  const raw = await readStdin();
  const input: HookInput = JSON.parse(raw);
  const result = await handleUserPromptSubmit(input);

  if (result) {
    process.stdout.write(JSON.stringify(result));
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    process.stderr.write(`[Entendi] Hook error: ${String(err)}\n`);
    process.exit(0);
  });
}
