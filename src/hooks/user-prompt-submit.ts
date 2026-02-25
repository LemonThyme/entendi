import { readStdin, getDataDir, getUserId, type HookInput } from './shared.js';
import { StateManager } from '../core/state-manager.js';
import { evaluateResponse } from '../core/probe-engine.js';
import {
  grmUpdate,
  mapRubricToFsrsGrade,
  fsrsStabilityAfterSuccess,
  fsrsDifficultyUpdate,
  retrievability,
  decayPrior,
} from '../core/probabilistic-model.js';
import { loadConfig, type ResolvedConfig } from '../config/config-loader.js';
import {
  isTutorActive,
  isTutorOffered,
  isPhaseScored,
  shouldOfferTutor,
  isTutorTimedOut,
  advanceTutorPhase,
} from '../core/tutor-session.js';
import {
  buildPhase1Prompt,
  buildPhase2Prompt,
  buildPhase3Prompt,
  buildPhase4Prompt,
  generateTutorQuestion,
} from '../core/tutor-engine.js';
import type {
  RubricScore,
  ProbeEvaluation,
  AssessmentEvent,
  TutorSession,
  TutorPhase,
} from '../schemas/types.js';
import { createTutorSession, createTutorExchange } from '../schemas/types.js';

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

// --- Teach-me pattern detection ---

const TEACH_ME_PATTERNS = [
  /teach\s+me\s+(?:about\s+)?(.+)/i,
  /explain\s+(.+?)(?:\s+to\s+me)?$/i,
  /help\s+me\s+understand\s+(.+)/i,
];

export function detectTeachMePattern(
  prompt: string,
  knownConcepts: Array<{ conceptId: string; aliases: string[] }>,
): string | null {
  for (const pattern of TEACH_ME_PATTERNS) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const extractedName = match[1].trim().replace(/[?.!]+$/, '').trim();
    if (!extractedName) continue;

    // Match against known concepts (case-insensitive)
    for (const concept of knownConcepts) {
      if (concept.conceptId.toLowerCase() === extractedName.toLowerCase()) {
        return concept.conceptId;
      }
      for (const alias of concept.aliases) {
        if (alias.toLowerCase() === extractedName.toLowerCase()) {
          return concept.conceptId;
        }
      }
    }
  }
  return null;
}

// --- Tutor prompt builder dispatch ---

function buildPromptForPhase(
  phase: TutorPhase,
  session: TutorSession,
): string {
  const exchanges = session.exchanges.map((ex) => ({
    phase: ex.phase,
    question: ex.question,
    response: ex.response,
  }));
  const conceptName = session.conceptId;
  const triggerContext = session.triggerProbeScore !== null
    ? `Scored ${session.triggerProbeScore}/3 on a probe about ${conceptName}`
    : `User requested help understanding ${conceptName}`;

  switch (phase) {
    case 'phase1':
      return buildPhase1Prompt({ conceptName, triggerContext });
    case 'phase2':
      return buildPhase2Prompt({ conceptName, exchanges });
    case 'phase3': {
      // Use stored misconception from previous phase generation
      const lastMisconception = session.lastMisconception ?? undefined;
      return buildPhase3Prompt({ conceptName, exchanges, misconception: lastMisconception });
    }
    case 'phase4':
      return buildPhase4Prompt({ conceptName, exchanges });
    default:
      return buildPhase1Prompt({ conceptName, triggerContext });
  }
}

async function generateQuestionForPhase(
  phase: TutorPhase,
  session: TutorSession,
  skipLLM: boolean,
): Promise<{ question: string; misconceptionDetected: string | null }> {
  if (skipLLM) {
    return {
      question: `[Entendi Tutor] Let's continue exploring ${session.conceptId}. Can you tell me more?`,
      misconceptionDetected: null,
    };
  }
  const prompt = buildPromptForPhase(phase, session);
  const result = await generateTutorQuestion(prompt);
  return {
    question: `[Entendi Tutor] ${result.question}`,
    misconceptionDetected: result.misconceptionDetected,
  };
}

// --- Accept/decline patterns ---

const ACCEPT_PATTERN = /^(yes|yeah|sure|ok|y|please)\b/i;
const DECLINE_PATTERN = /^(no|nah|skip|n|never mind)\b/i;

// --- Shared mastery update helper (Issue 6: deduplication) ---

interface MasteryUpdateParams {
  sm: StateManager;
  userId: string;
  conceptId: string;
  rubricScore: RubricScore;
  confidence: number;
  probeDepth: 0 | 1 | 2 | 3;
  eventType: AssessmentEvent['eventType'];
  tutored: boolean;
  tutoredEvidenceWeight?: number;
}

function applyMasteryUpdate(params: MasteryUpdateParams): void {
  const { sm, userId, conceptId, rubricScore, confidence, probeDepth, eventType, tutored, tutoredEvidenceWeight } = params;
  const kg = sm.getKnowledgeGraph();
  const ucs = kg.getUserConceptState(userId, conceptId);

  // Apply time decay
  let currentMastery = ucs.mastery;
  let R = 1.0;
  if (ucs.lastAssessed) {
    const elapsedDays = (Date.now() - new Date(ucs.lastAssessed).getTime()) / (1000 * 60 * 60 * 24);
    R = retrievability(elapsedDays, ucs.memory.stability);
    currentMastery = decayPrior(currentMastery.mu, currentMastery.sigma, R);
  }

  // GRM update
  const muBefore = currentMastery.mu;
  const concept = kg.getConcept(conceptId);
  const updatedMastery = grmUpdate(currentMastery, rubricScore, concept?.itemParams);

  // FSRS update
  const fsrsGrade = mapRubricToFsrsGrade(rubricScore);
  let newStability = ucs.memory.stability;
  let newDifficulty = ucs.memory.difficulty;
  if (fsrsGrade >= 2) {
    newStability = fsrsStabilityAfterSuccess(ucs.memory.stability, ucs.memory.difficulty, R, fsrsGrade);
  }
  newDifficulty = fsrsDifficultyUpdate(ucs.memory.difficulty, fsrsGrade);

  // Assessment event
  const event: AssessmentEvent = {
    timestamp: new Date().toISOString(),
    eventType,
    rubricScore,
    evaluatorConfidence: confidence,
    muBefore,
    muAfter: updatedMastery.mu,
    probeDepth,
    tutored,
  };

  // Apply mastery based on tutored/untutored
  if (tutored && tutoredEvidenceWeight !== undefined) {
    // Attenuated update for tutored assessments
    ucs.mastery = {
      mu: currentMastery.mu + tutoredEvidenceWeight * (updatedMastery.mu - currentMastery.mu),
      sigma: currentMastery.sigma + tutoredEvidenceWeight * (updatedMastery.sigma - currentMastery.sigma),
    };
    ucs.tutoredAssessmentCount += 1;
  } else {
    // Full update + shadow update
    ucs.mastery = updatedMastery;
    ucs.muUntutored = updatedMastery.mu;
    ucs.sigmaUntutored = updatedMastery.sigma;
    ucs.untutoredAssessmentCount += 1;
  }

  ucs.memory = { stability: newStability, difficulty: newDifficulty };
  ucs.lastAssessed = new Date().toISOString();
  ucs.assessmentCount += 1;
  ucs.history.push(event);

  kg.setUserConceptState(userId, conceptId, ucs);
}

// --- Tutor response handler ---

async function handleTutorResponse(
  sm: StateManager,
  userId: string,
  userResponse: string,
  skipLLM: boolean,
  config: ResolvedConfig,
): Promise<UserPromptSubmitOutput | null> {
  const session = sm.getTutorSession();
  if (!session) return null;

  // Check for timeout
  if (isTutorTimedOut(session)) {
    sm.clearTutorSession();
    sm.save();
    return {
      hookSpecificOutput: {
        additionalContext: `[Entendi] Your tutor session on "${session.conceptId}" has timed out due to inactivity.`,
      },
    };
  }

  const currentPhase = session.phase;

  // Fill in the user's response on the last exchange with response: null
  const lastExchange = session.exchanges.find((ex) => ex.response === null);
  if (lastExchange) {
    lastExchange.response = userResponse;
  }

  // Update lastActivityAt on every user response (Issue 4)
  session.lastActivityAt = new Date().toISOString();

  // Scoring for phase1 and phase4
  if (isPhaseScored(currentPhase)) {
    let evaluation: ProbeEvaluation;

    if (skipLLM) {
      evaluation = {
        rubricScore: 1 as RubricScore,
        confidence: 0.5,
        reasoning: 'Default evaluation (LLM skipped)',
        suggestFollowup: false,
        misconceptionDetected: null,
      };
    } else {
      const questionText = lastExchange?.question ?? '';
      evaluation = await evaluateResponse({
        question: questionText,
        response: userResponse,
        conceptName: session.conceptId,
        depth: currentPhase === 'phase1' ? 1 : 3,
      });
    }

    // Use shared mastery update helper (Issue 6)
    const isTutored = currentPhase === 'phase4';
    const eventType = currentPhase === 'phase1' ? 'tutor_phase1' : 'tutor_phase4';
    applyMasteryUpdate({
      sm,
      userId,
      conceptId: session.conceptId,
      rubricScore: evaluation.rubricScore,
      confidence: evaluation.confidence,
      probeDepth: currentPhase === 'phase1' ? 1 : 3,
      eventType,
      tutored: isTutored,
      tutoredEvidenceWeight: isTutored ? config.orgPolicy.tutoredEvidenceWeight : undefined,
    });

    // Set phase scores
    if (currentPhase === 'phase1') {
      session.phase1Score = evaluation.rubricScore;
    } else if (currentPhase === 'phase4') {
      session.phase4Score = evaluation.rubricScore;
    }
  }

  // Advance to next phase
  const advanced = advanceTutorPhase(session);
  // Mutate session in-place with the new phase
  session.phase = advanced.phase;

  if (session.phase === 'complete') {
    sm.clearTutorSession();
    sm.save();
    return {
      hookSpecificOutput: {
        additionalContext: `[Entendi] Tutor session on "${session.conceptId}" complete. Great work!`,
      },
    };
  }

  // Generate next question
  const genResult = await generateQuestionForPhase(session.phase, session, skipLLM);
  const exchange = createTutorExchange(session.phase, genResult.question);
  session.exchanges.push(exchange);

  // Store misconception from LLM response for forwarding to next phase (Issue 5)
  if (genResult.misconceptionDetected !== null) {
    session.lastMisconception = genResult.misconceptionDetected;
  }

  sm.setTutorSession(session);
  sm.save();

  return {
    hookSpecificOutput: {
      additionalContext: genResult.question,
    },
  };
}

// --- Main handler ---

export async function handleUserPromptSubmit(
  input: HookInput,
  options: UserPromptSubmitOptions = {},
): Promise<UserPromptSubmitOutput | null> {
  const { skipLLM = false } = options;
  const dataDir = options.dataDir ?? getDataDir(input.cwd);
  const userId = options.userId ?? getUserId();

  // 1. Load state and config
  const sm = new StateManager(dataDir, userId);
  const config = loadConfig(dataDir);

  // Issue 3: Check org policy enabled flag
  if (!config.orgPolicy.enabled) {
    return null;
  }

  const userResponse = (input.prompt as string) ?? '';
  const tutorSession = sm.getTutorSession();

  // 2. Priority 1: Active tutor session
  if (isTutorActive(tutorSession)) {
    return handleTutorResponse(sm, userId, userResponse, skipLLM, config);
  }

  // 3. Priority 2: Tutor offered — check accept/decline
  if (isTutorOffered(tutorSession)) {
    if (ACCEPT_PATTERN.test(userResponse.trim())) {
      // Accept: advance to phase1
      const session = tutorSession!;
      const advanced = advanceTutorPhase(session);
      session.phase = advanced.phase; // should be 'phase1'

      const genResult = await generateQuestionForPhase(session.phase, session, skipLLM);
      const exchange = createTutorExchange(session.phase, genResult.question);
      session.exchanges.push(exchange);

      // Store misconception if detected
      if (genResult.misconceptionDetected !== null) {
        session.lastMisconception = genResult.misconceptionDetected;
      }

      sm.setTutorSession(session);
      sm.save();

      return {
        hookSpecificOutput: {
          additionalContext: genResult.question,
        },
      };
    } else {
      // Decline (explicit or unrecognized input)
      sm.clearTutorSession();
      sm.save();
      return null;
    }
  }

  // 4. Priority 3: Pending probe
  const pendingProbe = sm.getProbeSession().pendingProbe;
  if (pendingProbe) {
    const { probe, triggerContext } = pendingProbe;

    // Evaluate the response
    let evaluation: ProbeEvaluation;

    if (skipLLM) {
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

    // Use shared mastery update helper (Issue 6)
    applyMasteryUpdate({
      sm,
      userId,
      conceptId: probe.conceptId,
      rubricScore: evaluation.rubricScore,
      confidence: evaluation.confidence,
      probeDepth: probe.depth,
      eventType: 'probe',
      tutored: false,
    });

    // Clear pending probe
    sm.clearPendingProbe();

    // Build base additionalContext
    const scoreLabel = ['No understanding', 'Surface', 'Functional', 'Deep'][
      evaluation.rubricScore
    ];
    let additionalContext = `[Entendi] Comprehension check on "${probe.conceptId}" — Score: ${evaluation.rubricScore}/3 (${scoreLabel}). ${evaluation.reasoning}`;

    // Check if we should offer tutor
    if (
      shouldOfferTutor(
        evaluation.rubricScore,
        config.orgPolicy.tutorTriggerThreshold,
        config.orgPolicy.tutorMode,
      )
    ) {
      const newTutorSession = createTutorSession(probe.conceptId, evaluation.rubricScore);

      // Issue 1: If autoAcceptTutor, skip OFFERED and go straight to phase1
      if (config.userPrefs.autoAcceptTutor) {
        newTutorSession.phase = 'phase1';
        const genResult = await generateQuestionForPhase('phase1', newTutorSession, skipLLM);
        const exchange = createTutorExchange('phase1', genResult.question);
        newTutorSession.exchanges.push(exchange);

        if (genResult.misconceptionDetected !== null) {
          newTutorSession.lastMisconception = genResult.misconceptionDetected;
        }

        sm.setTutorSession(newTutorSession);
        additionalContext += `\n${genResult.question}`;
      } else {
        sm.setTutorSession(newTutorSession);
        additionalContext += `\n[Entendi] Would you like me to help you understand ${probe.conceptId} better? (yes/no)`;
      }
    }

    sm.save();

    return {
      hookSpecificOutput: {
        additionalContext,
      },
    };
  }

  // 5. Priority 4: "Teach me" pattern detection
  const kg = sm.getKnowledgeGraph();
  const allConcepts = kg.getAllConcepts().map((c) => ({
    conceptId: c.conceptId,
    aliases: c.aliases,
  }));
  const matchedConcept = detectTeachMePattern(userResponse, allConcepts);

  if (matchedConcept) {
    const tutorMode = config.orgPolicy.tutorMode;
    if (tutorMode === 'proactive' || tutorMode === 'both') {
      // Create tutor session directly at phase1 (skip offered)
      const newSession = createTutorSession(matchedConcept, null);
      newSession.phase = 'phase1';

      const genResult = await generateQuestionForPhase('phase1', newSession, skipLLM);
      const exchange = createTutorExchange('phase1', genResult.question);
      newSession.exchanges.push(exchange);

      // Store misconception if detected
      if (genResult.misconceptionDetected !== null) {
        newSession.lastMisconception = genResult.misconceptionDetected;
      }

      sm.setTutorSession(newSession);
      sm.save();

      return {
        hookSpecificOutput: {
          additionalContext: genResult.question,
        },
      };
    }
  }

  // 6. Nothing to do
  return null;
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
