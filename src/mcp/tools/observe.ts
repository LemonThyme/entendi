import type { KnowledgeGraph } from '../../core/knowledge-graph.js';
import { type ProbeCandidateInfo, selectConceptToProbe, shouldProbe } from '../../core/probe-scheduler.js';
import type { StateManager } from '../../core/state-manager.js';
import type { NoveltyLevel } from '../../schemas/types.js';
import { createConceptNode, pMastery } from '../../schemas/types.js';
import { writePendingAction } from '../pending-action.js';

// --- Public types ---

export interface ObserveInput {
  concepts: Array<{ id: string; source: 'package' | 'ast' | 'llm' }>;
  triggerContext: string;
}

export interface ObserveOutput {
  shouldProbe: boolean;
  conceptId?: string;
  depth?: 1 | 2 | 3;
  intrusiveness: 'direct' | 'woven' | 'skip';
  guidance?: string;
  userProfile: 'unknown' | 'beginner' | 'intermediate' | 'advanced';
}

export interface ObserveOptions {
  forceProbe?: boolean;
  config?: { minProbeIntervalMinutes: number; maxProbesPerHour: number };
}

// --- Intrusiveness lookup table (design doc section 7) ---

type UserProfile = 'unknown' | 'beginner' | 'intermediate' | 'advanced';
type Intrusiveness = 'direct' | 'woven' | 'skip';

const INTRUSIVENESS_MAP: Record<UserProfile, Record<NoveltyLevel, Intrusiveness>> = {
  unknown:      { novel: 'direct',  adjacent: 'direct', routine: 'skip', critical: 'direct' },
  beginner:     { novel: 'direct',  adjacent: 'woven',  routine: 'skip', critical: 'direct' },
  intermediate: { novel: 'woven',   adjacent: 'woven',  routine: 'skip', critical: 'woven' },
  advanced:     { novel: 'woven',   adjacent: 'skip',   routine: 'skip', critical: 'woven' },
};

// --- User profile computation (design doc section 7) ---

function computeUserProfile(kg: KnowledgeGraph, userId: string): UserProfile {
  const allConcepts = kg.getAllConcepts();
  const assessed = allConcepts.filter(c => {
    const ucs = kg.getUserConceptState(userId, c.conceptId);
    return ucs.assessmentCount > 0;
  });
  if (assessed.length === 0) return 'unknown';
  const avgMastery = assessed.reduce((sum, c) => {
    const ucs = kg.getUserConceptState(userId, c.conceptId);
    return sum + pMastery(ucs.mastery.mu);
  }, 0) / assessed.length;
  if (avgMastery > 0.75) return 'advanced';
  if (avgMastery > 0.4) return 'intermediate';
  return 'beginner';
}

// --- Depth from novelty ---

function depthFromNovelty(novelty: NoveltyLevel): 1 | 2 | 3 {
  switch (novelty) {
    case 'novel':
    case 'critical':
      return 1;
    case 'adjacent':
      return 2;
    case 'routine':
      return 3;
  }
}

// --- Rate limit check ---

function isRateLimited(
  sm: StateManager,
  config: { minProbeIntervalMinutes: number; maxProbesPerHour: number },
): boolean {
  const session = sm.getProbeSession();

  // Check minProbeIntervalMinutes
  if (session.lastProbeTime) {
    const elapsed = (Date.now() - new Date(session.lastProbeTime).getTime()) / (1000 * 60);
    if (elapsed < config.minProbeIntervalMinutes) {
      return true;
    }
  }

  // Check maxProbesPerHour
  if (session.probesThisSession >= config.maxProbesPerHour) {
    return true;
  }

  return false;
}

// --- Guidance generation ---

function generateGuidance(conceptId: string, depth: 1 | 2 | 3): string {
  const concept = conceptId.replace(/\//g, ' ').replace(/-/g, ' ');
  switch (depth) {
    case 1:
      return `Ask about the core purpose and basic usage of ${concept}`;
    case 2:
      return `Ask about trade-offs and design decisions related to ${concept}`;
    case 3:
      return `Ask about edge cases and failure modes in ${concept}`;
  }
}

// --- Main handler ---

export function handleObserve(
  input: ObserveInput,
  sm: StateManager,
  userId: string,
  options?: ObserveOptions,
): ObserveOutput {
  const kg = sm.getKnowledgeGraph();
  const forceProbe = options?.forceProbe ?? false;
  const rateConfig = options?.config ?? { minProbeIntervalMinutes: 2, maxProbesPerHour: 15 };

  // Step 1: Ensure all concepts exist in the knowledge graph
  for (const concept of input.concepts) {
    if (!kg.getConcept(concept.id)) {
      kg.addConcept(createConceptNode({
        conceptId: concept.id,
        domain: 'general',
        specificity: 'topic',
      }));
    }
  }

  // Step 2: Build ProbeCandidateInfo[] from input concepts
  const candidates: ProbeCandidateInfo[] = input.concepts.map(c => {
    const ucs = kg.getUserConceptState(userId, c.id);
    const conceptNode = kg.getConcept(c.id);
    const daysSinceAssessment = ucs.lastAssessed
      ? (Date.now() - new Date(ucs.lastAssessed).getTime()) / (1000 * 60 * 60 * 24)
      : 999; // Never assessed — treat as very old
    return {
      conceptId: c.id,
      mu: ucs.mastery.mu,
      sigma: ucs.mastery.sigma,
      stability: ucs.memory.stability,
      daysSinceAssessment,
      itemParams: conceptNode?.itemParams ?? { discrimination: 1.0, thresholds: [-1.0, 0.0, 1.0] as [number, number, number] },
    };
  });

  // Step 3: Select best concept via Fisher information
  const selectedId = selectConceptToProbe(candidates);
  if (!selectedId) {
    return {
      shouldProbe: false,
      intrusiveness: 'skip',
      userProfile: computeUserProfile(kg, userId),
    };
  }

  // Step 4: Classify novelty for the selected concept
  const novelty = kg.classifyNovelty(userId, selectedId);

  // Step 5: Check rate limits
  if (isRateLimited(sm, rateConfig)) {
    return {
      shouldProbe: false,
      conceptId: selectedId,
      intrusiveness: 'skip',
      userProfile: computeUserProfile(kg, userId),
    };
  }

  // Step 6: Decide whether to probe (probabilistic or forced)
  const willProbe = shouldProbe(novelty, forceProbe);

  // Step 7: Compute user profile
  const userProfile = computeUserProfile(kg, userId);

  // Step 8: Compute intrusiveness
  const intrusiveness = INTRUSIVENESS_MAP[userProfile][novelty];

  // If intrusiveness is skip, don't probe
  if (intrusiveness === 'skip') {
    return {
      shouldProbe: false,
      conceptId: selectedId,
      intrusiveness: 'skip',
      userProfile,
    };
  }

  if (!willProbe) {
    return {
      shouldProbe: false,
      conceptId: selectedId,
      intrusiveness,
      userProfile,
    };
  }

  // Step 9: Compute depth from novelty
  const depth = depthFromNovelty(novelty);

  // Step 10: Generate guidance
  const guidance = generateGuidance(selectedId, depth);

  // Step 11: Write pending action and update probe session
  writePendingAction(sm.getDataDir(), {
    type: 'awaiting_probe_response',
    conceptId: selectedId,
    depth,
    timestamp: new Date().toISOString(),
  });

  // Update probe session tracking
  const probeSession = sm.getProbeSession();
  probeSession.lastProbeTime = new Date().toISOString();
  probeSession.probesThisSession++;
  sm.save();

  return {
    shouldProbe: true,
    conceptId: selectedId,
    depth,
    intrusiveness,
    guidance,
    userProfile,
  };
}
