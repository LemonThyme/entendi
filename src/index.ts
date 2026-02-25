export { KnowledgeGraph } from './core/knowledge-graph.js';
export { StateManager } from './core/state-manager.js';
export {
  retrievability,
  decayPrior,
  bayesianUpdate,
  fsrsStabilityAfterSuccess,
  fsrsDifficultyUpdate,
  mapRubricToFsrsGrade,
  grmCategoryProbs,
  grmBayesianUpdate,
  grmUpdate,
  grmFisherInformation,
} from './core/probabilistic-model.js';
export type { GRMUpdateResult } from './core/probabilistic-model.js';
export {
  detectPackageInstall,
  parsePackageFromCommand,
  extractConceptsFromPackage,
} from './core/concept-extraction.js';
export { shouldProbe, selectConceptToProbe } from './core/probe-scheduler.js';
export {
  generateProbe,
  evaluateResponse,
  buildProbePrompt,
  buildEvaluationPrompt,
} from './core/probe-engine.js';
export {
  buildConceptExtractionPrompt,
  parseConceptExtractionResponse,
  extractConceptsViaLLM,
} from './core/llm-extraction.js';
export {
  initParser,
  extractConceptsFromSource,
  type ASTExtractedConcept,
  type SupportedLanguage,
} from './core/ast-extraction.js';
export { SEED_CONCEPTS, buildSeedConceptNodes, seedTaxonomyStats } from './config/seed-taxonomy.js';

// Tutor engine
export {
  buildPhase1Prompt,
  buildPhase2Prompt,
  buildPhase3Prompt,
  buildPhase4Prompt,
  parseTutorResponse,
  generateTutorQuestion,
  type ParsedTutorResponse,
} from './core/tutor-engine.js';

// Tutor state machine
export {
  advanceTutorPhase,
  isTutorActive,
  isTutorOffered,
  isPhaseScored,
  shouldOfferTutor,
  isTutorTimedOut,
  TUTOR_TIMEOUT_MS,
} from './core/tutor-session.js';

// Config
export {
  createDefaultOrgPolicy,
  createDefaultUserPreferences,
  type OrgPolicy,
  type UserPreferences,
} from './config/org-policy.js';

export {
  loadConfig,
  type ResolvedConfig,
} from './config/config-loader.js';

export * from './schemas/types.js';
