import {
  type ConceptNode,
  type UserConceptState,
  type KnowledgeGraphState,
  type NoveltyLevel,
  createUserConceptState,
  createEmptyGraphState,
  pMastery,
} from '../schemas/types.js';
import { retrievability } from './probabilistic-model.js';

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
    this.state.userStates[key] = ucs;
  }

  classifyNovelty(userId: string, conceptId: string): NoveltyLevel {
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

  toJSON(): string {
    return JSON.stringify(this.state);
  }

  static fromJSON(json: string): KnowledgeGraph {
    const state = JSON.parse(json) as KnowledgeGraphState;
    return new KnowledgeGraph(state);
  }

  getState(): KnowledgeGraphState {
    return this.state;
  }
}
