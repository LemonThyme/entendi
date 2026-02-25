// --- Mastery (IRT scale) ---
export interface MasteryState {
  mu: number;       // Normal posterior mean (IRT scale, real line)
  sigma: number;    // Normal posterior std dev
}

export function createInitialMastery(): MasteryState {
  return { mu: 0.0, sigma: 1.5 };
}

export function pMastery(mu: number): number {
  return 1 / (1 + Math.exp(-mu));
}

// --- Memory (FSRS) ---
export interface MemoryState {
  stability: number;   // S: days until R drops to 90%
  difficulty: number;  // D: 1-10 scale
}

export function createInitialMemory(): MemoryState {
  return { stability: 1.0, difficulty: 5.0 };
}

// --- GRM Item Parameters ---
export interface GRMItemParams {
  discrimination: number;                    // a parameter
  thresholds: [number, number, number];      // b1 < b2 < b3
}

export const DEFAULT_GRM_PARAMS: GRMItemParams = {
  discrimination: 1.0,
  thresholds: [-1.0, 0.0, 1.0],
};

// --- Concept Node ---
export type ConceptSpecificity = 'domain' | 'topic' | 'technique';
export type ConceptLifecycle = 'discovered' | 'candidate' | 'normalized' | 'validated' | 'stable' | 'deprecated';
export type EdgeType = 'requires' | 'part_of' | 'related_to' | 'alternative_to' | 'used_with' | 'is_example_of';

export interface ConceptEdge {
  target: string;
  type: EdgeType;
}

// --- Population Statistics ---
export interface PopulationStats {
  meanMastery: number;
  assessmentCount: number;
  failureRate: number;
}

export function createDefaultPopulationStats(): PopulationStats {
  return { meanMastery: 0, assessmentCount: 0, failureRate: 0 };
}

export interface ConceptNode {
  conceptId: string;
  aliases: string[];
  domain: string;
  specificity: ConceptSpecificity;
  parentConcept: string | null;
  itemParams: GRMItemParams;
  relationships: ConceptEdge[];
  lifecycle: ConceptLifecycle;
  populationStats: PopulationStats;
}

// --- Taxonomy Seed Entry ---
export interface TaxonomySeedEntry {
  conceptId: string;
  aliases: string[];
  domain: string;
  specificity: ConceptSpecificity;
  parentConcept: string | null;
  relationships: ConceptEdge[];
}

// --- Concept Node Factory ---
export interface CreateConceptNodeSeed {
  conceptId: string;
  domain: string;
  specificity: ConceptSpecificity;
  aliases?: string[];
  parentConcept?: string | null;
  itemParams?: GRMItemParams;
  relationships?: ConceptEdge[];
  lifecycle?: ConceptLifecycle;
  populationStats?: PopulationStats;
}

export function createConceptNode(seed: CreateConceptNodeSeed): ConceptNode {
  return {
    conceptId: seed.conceptId,
    aliases: seed.aliases ?? [],
    domain: seed.domain,
    specificity: seed.specificity,
    parentConcept: seed.parentConcept ?? null,
    itemParams: seed.itemParams ?? DEFAULT_GRM_PARAMS,
    relationships: seed.relationships ?? [],
    lifecycle: seed.lifecycle ?? 'discovered',
    populationStats: seed.populationStats ?? createDefaultPopulationStats(),
  };
}

// --- User Concept State ---
export type AssessmentEventType = 'probe' | 'tutor_phase1' | 'tutor_phase4' | 'implicit';

export interface AssessmentEvent {
  timestamp: string;
  eventType: AssessmentEventType;
  rubricScore: 0 | 1 | 2 | 3;
  evaluatorConfidence: number;
  muBefore: number;
  muAfter: number;
  probeDepth: 0 | 1 | 2 | 3;
  tutored: boolean;
}

export interface UserConceptState {
  conceptId: string;
  userId: string;
  mastery: MasteryState;
  memory: MemoryState;
  lastAssessed: string | null;
  assessmentCount: number;
  history: AssessmentEvent[];
  tutoredAssessmentCount: number;
  untutoredAssessmentCount: number;
  muUntutored: number;
  sigmaUntutored: number;
}

export function createUserConceptState(conceptId: string, userId: string): UserConceptState {
  return {
    conceptId,
    userId,
    mastery: createInitialMastery(),
    memory: createInitialMemory(),
    lastAssessed: null,
    assessmentCount: 0,
    history: [],
    tutoredAssessmentCount: 0,
    untutoredAssessmentCount: 0,
    muUntutored: 0.0,
    sigmaUntutored: 1.5,
  };
}

// --- Observation Events ---
export type ObservationEventType = 'prompt' | 'response' | 'tool_call' | 'file_mutation' | 'probe_response';
export type AdapterType = 'claude_code_hooks' | 'vscode_extension' | 'api_proxy' | 'browser_ext';

export interface ExtractedConcept {
  name: string;
  specificity: ConceptSpecificity;
  confidence: number;
  extractionSignal: 'package' | 'ast' | 'llm';
}

export interface ObservationEvent {
  eventId: string;
  eventType: ObservationEventType;
  timestamp: string;
  userId: string;
  adapter: AdapterType;
  sessionId: string;
  content: {
    raw: string;
    fileContext: string | null;
    projectContext: string | null;
  };
  conceptsExtracted: ExtractedConcept[];
}

// --- Probe State ---
export type NoveltyLevel = 'routine' | 'adjacent' | 'novel' | 'critical';
export type RubricScore = 0 | 1 | 2 | 3;

export interface Probe {
  probeId: string;
  conceptId: string;
  question: string;
  depth: 0 | 1 | 2 | 3;
  probeType: 'why' | 'transfer' | 'failure' | 'counterfactual' | 'dependency' | 'context_bound';
}

export interface ProbeEvaluation {
  rubricScore: RubricScore;
  confidence: number;
  reasoning: string;
  suggestFollowup: boolean;
  misconceptionDetected: string | null;
}

export interface PendingProbe {
  probe: Probe;
  triggeredAt: string;
  triggerContext: string;
  previousResponses: Array<{ question: string; response: string; score: RubricScore }>;
}

export interface ProbeSessionState {
  pendingProbe: PendingProbe | null;
  lastProbeTime: string | null;
  probesThisSession: number;
}

// --- Tutor Session ---
export type TutorPhase = 'offered' | 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'complete';

export interface TutorExchange {
  phase: TutorPhase;
  question: string;
  response: string | null;
}

export interface TutorSession {
  sessionId: string;
  conceptId: string;
  phase: TutorPhase;
  startedAt: string;
  triggerProbeScore: RubricScore | null;
  exchanges: TutorExchange[];
  phase1Score: RubricScore | null;
  phase4Score: RubricScore | null;
}

export function createTutorSession(conceptId: string, triggerProbeScore: RubricScore | null): TutorSession {
  return {
    sessionId: `tutor_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    conceptId,
    phase: 'offered',
    startedAt: new Date().toISOString(),
    triggerProbeScore,
    exchanges: [],
    phase1Score: null,
    phase4Score: null,
  };
}

export function createTutorExchange(phase: TutorPhase, question: string): TutorExchange {
  return { phase, question, response: null };
}

// --- Knowledge Graph State (JSON persistence) ---
export interface KnowledgeGraphState {
  concepts: Record<string, ConceptNode>;
  userStates: Record<string, UserConceptState>;
}

export function createEmptyGraphState(): KnowledgeGraphState {
  return { concepts: {}, userStates: {} };
}
