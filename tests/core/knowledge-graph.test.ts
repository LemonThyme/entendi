import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph } from '../../src/core/knowledge-graph.js';
import type { ConceptNode } from '../../src/schemas/types.js';

describe('KnowledgeGraph', () => {
  let kg: KnowledgeGraph;

  beforeEach(() => {
    kg = new KnowledgeGraph();
  });

  describe('concept management', () => {
    it('adds and retrieves a concept', () => {
      kg.addConcept({
        conceptId: 'redis',
        aliases: ['Redis'],
        domain: 'databases',
        specificity: 'topic',
        parentConcept: null,
        itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
        relationships: [],
        lifecycle: 'validated',
        populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
      });
      expect(kg.getConcept('redis')).toBeDefined();
      expect(kg.getConcept('redis')!.domain).toBe('databases');
    });

    it('returns undefined for missing concept', () => {
      expect(kg.getConcept('nonexistent')).toBeUndefined();
    });

    it('lists all concepts', () => {
      kg.addConcept({
        conceptId: 'redis', aliases: [], domain: 'databases', specificity: 'topic',
        parentConcept: null, itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
        relationships: [], lifecycle: 'validated',
        populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
      });
      kg.addConcept({
        conceptId: 'react', aliases: [], domain: 'frontend', specificity: 'topic',
        parentConcept: null, itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
        relationships: [], lifecycle: 'validated',
        populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
      });
      expect(kg.getAllConcepts()).toHaveLength(2);
    });
  });

  describe('user concept state', () => {
    it('creates initial state for new user+concept pair', () => {
      kg.addConcept({
        conceptId: 'redis', aliases: [], domain: 'databases', specificity: 'topic',
        parentConcept: null, itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
        relationships: [], lifecycle: 'validated',
        populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
      });
      const state = kg.getUserConceptState('user1', 'redis');
      expect(state.mastery.mu).toBe(0);
      expect(state.mastery.sigma).toBe(1.5);
      expect(state.assessmentCount).toBe(0);
    });

    it('persists state updates', () => {
      kg.addConcept({
        conceptId: 'redis', aliases: [], domain: 'databases', specificity: 'topic',
        parentConcept: null, itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
        relationships: [], lifecycle: 'validated',
        populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
      });
      const state = kg.getUserConceptState('user1', 'redis');
      state.mastery.mu = 1.5;
      kg.setUserConceptState('user1', 'redis', state);
      const retrieved = kg.getUserConceptState('user1', 'redis');
      expect(retrieved.mastery.mu).toBe(1.5);
    });
  });

  describe('novelty classification', () => {
    it('classifies unknown concept as novel', () => {
      expect(kg.classifyNovelty('user1', 'unknown_concept')).toBe('novel');
    });

    it('classifies mastered concept as routine', () => {
      kg.addConcept({
        conceptId: 'javascript', aliases: [], domain: 'languages', specificity: 'topic',
        parentConcept: null, itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
        relationships: [], lifecycle: 'validated',
        populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
      });
      const state = kg.getUserConceptState('user1', 'javascript');
      state.mastery.mu = 3.0;
      state.mastery.sigma = 0.3;
      state.assessmentCount = 5;
      state.lastAssessed = new Date().toISOString();
      state.memory.stability = 30;
      kg.setUserConceptState('user1', 'javascript', state);
      expect(kg.classifyNovelty('user1', 'javascript')).toBe('routine');
    });

    it('classifies low mastery as novel', () => {
      kg.addConcept({
        conceptId: 'rust', aliases: [], domain: 'languages', specificity: 'topic',
        parentConcept: null, itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
        relationships: [], lifecycle: 'validated',
        populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
      });
      const state = kg.getUserConceptState('user1', 'rust');
      state.mastery.mu = -1.5;
      state.assessmentCount = 1;
      state.lastAssessed = new Date().toISOString();
      kg.setUserConceptState('user1', 'rust', state);
      expect(kg.classifyNovelty('user1', 'rust')).toBe('novel');
    });
  });

  describe('serialization', () => {
    it('round-trips through JSON', () => {
      kg.addConcept({
        conceptId: 'redis', aliases: ['Redis'], domain: 'databases', specificity: 'topic',
        parentConcept: null, itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
        relationships: [], lifecycle: 'validated',
        populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
      });
      const state = kg.getUserConceptState('user1', 'redis');
      state.mastery.mu = 1.5;
      kg.setUserConceptState('user1', 'redis', state);

      const json = kg.toJSON();
      const kg2 = KnowledgeGraph.fromJSON(json);
      expect(kg2.getConcept('redis')!.domain).toBe('databases');
      expect(kg2.getUserConceptState('user1', 'redis').mastery.mu).toBe(1.5);
    });
  });
});
