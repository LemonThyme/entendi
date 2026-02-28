import { grmFisherInformation } from '../../core/probabilistic-model.js';
import type { StateManager } from '../../core/state-manager.js';
import { pMastery } from '../../schemas/types.js';

// --- Types ---

export interface GetStatusInput {
  conceptId?: string;
}

export interface GetStatusOutput {
  concept?: {
    mastery: number;
    sigma: number;
    assessmentCount: number;
    lastAssessed: string | null;
    tutoredCount: number;
    untutoredCount: number;
  };
  overview?: {
    totalConcepts: number;
    mastered: number;
    inProgress: number;
    unknown: number;
    recentActivity: string[];
  };
}

export interface GetZPDFrontierOutput {
  frontier: Array<{ conceptId: string; mastery: number; fisherInfo: number }>;
  totalConcepts: number;
  masteredCount: number;
}

// --- Mastery threshold for "mastered" classification ---
const MASTERY_THRESHOLD = 0.7;

// --- Handlers ---

/**
 * Query mastery state for a specific concept or get an overview of all concepts.
 *
 * - If `conceptId` provided: return mastery details for that concept.
 * - If omitted: return overview (totalConcepts, mastered, inProgress, unknown, recentActivity).
 */
export function handleGetStatus(
  input: GetStatusInput,
  sm: StateManager,
  userId: string,
): GetStatusOutput {
  const kg = sm.getKnowledgeGraph();

  if (input.conceptId !== undefined) {
    // Single concept detail
    const ucs = kg.getUserConceptState(userId, input.conceptId);
    return {
      concept: {
        mastery: pMastery(ucs.mastery.mu),
        sigma: ucs.mastery.sigma,
        assessmentCount: ucs.assessmentCount,
        lastAssessed: ucs.lastAssessed,
        tutoredCount: ucs.tutoredAssessmentCount,
        untutoredCount: ucs.untutoredAssessmentCount,
      },
    };
  }

  // Overview mode
  const allConcepts = kg.getAllConcepts();
  let mastered = 0;
  let inProgress = 0;
  let unknown = 0;
  const recentAssessments: Array<{ conceptId: string; timestamp: string }> = [];

  for (const concept of allConcepts) {
    const ucs = kg.getUserConceptState(userId, concept.conceptId);

    if (ucs.assessmentCount === 0) {
      unknown++;
    } else if (pMastery(ucs.mastery.mu) >= MASTERY_THRESHOLD) {
      mastered++;
    } else {
      inProgress++;
    }

    // Collect recent assessment activity
    if (ucs.lastAssessed) {
      recentAssessments.push({
        conceptId: concept.conceptId,
        timestamp: ucs.lastAssessed,
      });
    }
  }

  // Sort by most recent first, take top 5
  recentAssessments.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const recentActivity = recentAssessments
    .slice(0, 5)
    .map(r => `${r.conceptId} (${r.timestamp})`);

  return {
    overview: {
      totalConcepts: allConcepts.length,
      mastered,
      inProgress,
      unknown,
      recentActivity,
    },
  };
}

/**
 * Get the Zone of Proximal Development frontier: concepts the user is ready to learn next.
 *
 * Uses KnowledgeGraph.getZPDFrontier() which returns concept IDs where all
 * prerequisites are mastered but the concept itself is not, sorted by Fisher info.
 */
export function handleGetZPDFrontier(
  sm: StateManager,
  userId: string,
): GetZPDFrontierOutput {
  const kg = sm.getKnowledgeGraph();
  const allConcepts = kg.getAllConcepts();

  // Count mastered concepts
  let masteredCount = 0;
  for (const concept of allConcepts) {
    const ucs = kg.getUserConceptState(userId, concept.conceptId);
    if (pMastery(ucs.mastery.mu) >= MASTERY_THRESHOLD) {
      masteredCount++;
    }
  }

  // Get ZPD frontier (already sorted by Fisher info descending)
  const frontierIds = kg.getZPDFrontier(userId, MASTERY_THRESHOLD);

  const frontier = frontierIds.map(conceptId => {
    const ucs = kg.getUserConceptState(userId, conceptId);
    const concept = kg.getConcept(conceptId);
    return {
      conceptId,
      mastery: pMastery(ucs.mastery.mu),
      fisherInfo: grmFisherInformation(ucs.mastery.mu, concept?.itemParams),
    };
  });

  return {
    frontier,
    totalConcepts: allConcepts.length,
    masteredCount,
  };
}
