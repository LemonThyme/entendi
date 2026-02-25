import {
  type ConceptNode,
  type UserConceptState,
  type KnowledgeGraphState,
  type NoveltyLevel,
  createUserConceptState,
  createEmptyGraphState,
  pMastery,
} from '../schemas/types.js';
import { retrievability, grmFisherInformation } from './probabilistic-model.js';

export class KnowledgeGraph {
  private state: KnowledgeGraphState;

  constructor(state?: KnowledgeGraphState) {
    this.state = state ?? createEmptyGraphState();
  }

  addConcept(concept: ConceptNode): void {
    this.state.concepts[concept.conceptId] = concept;
  }

  getConcept(conceptId: string): ConceptNode | undefined {
    return this.state.concepts[conceptId];
  }

  getAllConcepts(): ConceptNode[] {
    return Object.values(this.state.concepts);
  }

  getUserConceptState(userId: string, conceptId: string): UserConceptState {
    const key = `${userId}:${conceptId}`;
    if (!this.state.userStates[key]) {
      this.state.userStates[key] = createUserConceptState(conceptId, userId);
    }
    return this.state.userStates[key];
  }

  setUserConceptState(userId: string, conceptId: string, ucs: UserConceptState): void {
    const key = `${userId}:${conceptId}`;
    // Cap assessment history at 50 events
    if (ucs.history.length > 50) {
      ucs.history = ucs.history.slice(-50);
    }
    this.state.userStates[key] = ucs;
  }

  classifyNovelty(userId: string, conceptId: string): NoveltyLevel {
    // Security domain concepts are always critical
    const concept = this.state.concepts[conceptId];
    if (concept && concept.domain === 'security') {
      return 'critical';
    }

    const key = `${userId}:${conceptId}`;
    const ucs = this.state.userStates[key];

    // No state at all or never assessed: novel
    if (!ucs || ucs.assessmentCount === 0) {
      return 'novel';
    }

    const pm = pMastery(ucs.mastery.mu);

    // Compute retrievability from elapsed time
    let R = 1.0;
    if (ucs.lastAssessed) {
      const elapsed = (Date.now() - new Date(ucs.lastAssessed).getTime()) / (1000 * 60 * 60 * 24);
      R = retrievability(elapsed, ucs.memory.stability);
    }

    if (pm > 0.8 && R > 0.7) {
      return 'routine';
    }
    if (pm > 0.3) {
      return 'adjacent';
    }
    return 'novel';
  }

  /**
   * Compute the Zone of Proximal Development frontier for a user.
   * Returns concept IDs where all prerequisites are mastered but the concept itself is not.
   * Concepts with no prerequisites and low mastery are also included.
   */
  getZPDFrontier(userId: string, threshold: number = 0.7): string[] {
    const frontier: string[] = [];

    for (const concept of this.getAllConcepts()) {
      const ucs = this.getUserConceptState(userId, concept.conceptId);
      const pm = pMastery(ucs.mastery.mu);

      // Already mastered — skip
      if (pm >= threshold) continue;

      // Check prerequisites
      const prereqs = concept.relationships.filter(r => r.type === 'requires');
      if (prereqs.length === 0) {
        frontier.push(concept.conceptId);
        continue;
      }

      // All prerequisites must be mastered
      const allPrereqsMastered = prereqs.every(r => {
        const prereqState = this.getUserConceptState(userId, r.target);
        return pMastery(prereqState.mastery.mu) >= threshold;
      });

      if (allPrereqsMastered) {
        frontier.push(concept.conceptId);
      }
    }

    // Sort by Fisher information descending (most informative first)
    frontier.sort((a, b) => {
      const ucsA = this.getUserConceptState(userId, a);
      const ucsB = this.getUserConceptState(userId, b);
      const conceptA = this.getConcept(a);
      const conceptB = this.getConcept(b);
      const fisherA = grmFisherInformation(ucsA.mastery.mu, conceptA?.itemParams);
      const fisherB = grmFisherInformation(ucsB.mastery.mu, conceptB?.itemParams);
      return fisherB - fisherA;
    });

    return frontier;
  }

  toJSON(): string {
    return JSON.stringify(this.state, null, 2);
  }

  static fromJSON(json: string): KnowledgeGraph {
    const state = JSON.parse(json) as KnowledgeGraphState;
    return new KnowledgeGraph(state);
  }

  getState(): KnowledgeGraphState {
    return this.state;
  }
}
