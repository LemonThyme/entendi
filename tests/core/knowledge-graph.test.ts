import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeGraph } from '../../src/core/knowledge-graph.js';
import type { ConceptNode } from '../../src/schemas/types.js';
import { createConceptNode } from '../../src/schemas/types.js';

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

  describe('classifyNovelty (critical support)', () => {
    it('classifies security concepts as critical regardless of mastery', () => {
      const graph = new KnowledgeGraph();
      const concept = createConceptNode({
        conceptId: 'sql-injection',
        domain: 'security',
        specificity: 'technique',
      });
      graph.addConcept(concept);

      const state = graph.getUserConceptState('user1', 'sql-injection');
      state.mastery.mu = 2.0;
      state.assessmentCount = 5;
      state.lastAssessed = new Date().toISOString();
      state.memory.stability = 30;
      graph.setUserConceptState('user1', 'sql-injection', state);

      const novelty = graph.classifyNovelty('user1', 'sql-injection');
      expect(novelty).toBe('critical');
    });

    it('does not classify non-security concepts as critical', () => {
      const graph = new KnowledgeGraph();
      const concept = createConceptNode({
        conceptId: 'redis',
        domain: 'databases',
        specificity: 'topic',
      });
      graph.addConcept(concept);

      const novelty = graph.classifyNovelty('user1', 'redis');
      expect(novelty).toBe('novel'); // No user state, so novel
    });

    it('classifies security concept as critical even with no user state', () => {
      const graph = new KnowledgeGraph();
      const concept = createConceptNode({
        conceptId: 'xss',
        domain: 'security',
        specificity: 'technique',
      });
      graph.addConcept(concept);

      const novelty = graph.classifyNovelty('user1', 'xss');
      expect(novelty).toBe('critical');
    });
  });

  describe('assessment history cap', () => {
    it('caps history at 50 events', () => {
      const graph = new KnowledgeGraph();
      const state = graph.getUserConceptState('user1', 'test-concept');
      for (let i = 0; i < 60; i++) {
        state.history.push({
          timestamp: new Date().toISOString(),
          eventType: 'probe',
          rubricScore: 2,
          evaluatorConfidence: 0.8,
          muBefore: 0,
          muAfter: 0.5,
          probeDepth: 0,
          tutored: false,
        });
      }
      graph.setUserConceptState('user1', 'test-concept', state);
      const saved = graph.getUserConceptState('user1', 'test-concept');
      expect(saved.history.length).toBeLessThanOrEqual(50);
    });

    it('keeps the most recent 50 events when capping', () => {
      const graph = new KnowledgeGraph();
      const state = graph.getUserConceptState('user1', 'test-concept');
      for (let i = 0; i < 60; i++) {
        state.history.push({
          timestamp: new Date().toISOString(),
          eventType: 'probe',
          rubricScore: 2,
          evaluatorConfidence: 0.8,
          muBefore: i, // Use muBefore to identify the event
          muAfter: 0.5,
          probeDepth: 0,
          tutored: false,
        });
      }
      graph.setUserConceptState('user1', 'test-concept', state);
      const saved = graph.getUserConceptState('user1', 'test-concept');
      expect(saved.history.length).toBe(50);
      // The first event retained should be the 11th original (index 10), muBefore=10
      expect(saved.history[0].muBefore).toBe(10);
      // The last event retained should be the 60th original (index 59), muBefore=59
      expect(saved.history[49].muBefore).toBe(59);
    });

    it('does not truncate history at or below 50', () => {
      const graph = new KnowledgeGraph();
      const state = graph.getUserConceptState('user1', 'test-concept');
      for (let i = 0; i < 50; i++) {
        state.history.push({
          timestamp: new Date().toISOString(),
          eventType: 'probe',
          rubricScore: 2,
          evaluatorConfidence: 0.8,
          muBefore: 0,
          muAfter: 0.5,
          probeDepth: 0,
          tutored: false,
        });
      }
      graph.setUserConceptState('user1', 'test-concept', state);
      const saved = graph.getUserConceptState('user1', 'test-concept');
      expect(saved.history.length).toBe(50);
    });
  });

  describe('getZPDFrontier', () => {
    it('returns concepts with no prerequisites and low mastery', () => {
      const graph = new KnowledgeGraph();
      graph.addConcept(createConceptNode({
        conceptId: 'intro-js',
        domain: 'languages',
        specificity: 'topic',
      }));
      graph.addConcept(createConceptNode({
        conceptId: 'intro-python',
        domain: 'languages',
        specificity: 'topic',
      }));

      const frontier = graph.getZPDFrontier('user1');
      expect(frontier).toContain('intro-js');
      expect(frontier).toContain('intro-python');
    });

    it('includes concepts whose prerequisites are mastered', () => {
      const graph = new KnowledgeGraph();
      graph.addConcept(createConceptNode({
        conceptId: 'basics',
        domain: 'languages',
        specificity: 'topic',
      }));
      graph.addConcept(createConceptNode({
        conceptId: 'advanced',
        domain: 'languages',
        specificity: 'topic',
        relationships: [{ target: 'basics', type: 'requires' }],
      }));

      // Set prereq as mastered (mu=2.0 -> P~0.88)
      const prereqState = graph.getUserConceptState('user1', 'basics');
      prereqState.mastery.mu = 2.0;
      graph.setUserConceptState('user1', 'basics', prereqState);

      const frontier = graph.getZPDFrontier('user1');
      expect(frontier).toContain('advanced');
      // 'basics' should NOT be in the frontier since it's mastered
      expect(frontier).not.toContain('basics');
    });

    it('excludes concepts whose prerequisites are not mastered', () => {
      const graph = new KnowledgeGraph();
      graph.addConcept(createConceptNode({
        conceptId: 'prereq',
        domain: 'languages',
        specificity: 'topic',
      }));
      graph.addConcept(createConceptNode({
        conceptId: 'dependent',
        domain: 'languages',
        specificity: 'topic',
        relationships: [{ target: 'prereq', type: 'requires' }],
      }));

      // Default mu=0 -> P=0.5, below threshold of 0.7
      const frontier = graph.getZPDFrontier('user1');
      expect(frontier).toContain('prereq'); // no prereqs, low mastery
      expect(frontier).not.toContain('dependent'); // prereq not mastered
    });

    it('excludes concepts already mastered', () => {
      const graph = new KnowledgeGraph();
      graph.addConcept(createConceptNode({
        conceptId: 'mastered-concept',
        domain: 'languages',
        specificity: 'topic',
      }));

      // Set mu=2.0 -> P~0.88, above threshold
      const state = graph.getUserConceptState('user1', 'mastered-concept');
      state.mastery.mu = 2.0;
      graph.setUserConceptState('user1', 'mastered-concept', state);

      const frontier = graph.getZPDFrontier('user1');
      expect(frontier).not.toContain('mastered-concept');
    });

    it('respects custom mastery threshold', () => {
      const graph = new KnowledgeGraph();
      graph.addConcept(createConceptNode({
        conceptId: 'mid-concept',
        domain: 'languages',
        specificity: 'topic',
      }));

      // mu=1.0 -> P~0.73: mastered at 0.7 but not at 0.8
      const state = graph.getUserConceptState('user1', 'mid-concept');
      state.mastery.mu = 1.0;
      graph.setUserConceptState('user1', 'mid-concept', state);

      // At threshold 0.7, this concept IS mastered (P~0.73 >= 0.7)
      const frontierLow = graph.getZPDFrontier('user1', 0.7);
      expect(frontierLow).not.toContain('mid-concept');

      // At threshold 0.8, this concept is NOT mastered (P~0.73 < 0.8)
      const frontierHigh = graph.getZPDFrontier('user1', 0.8);
      expect(frontierHigh).toContain('mid-concept');
    });

    it('sorts frontier by Fisher information descending (Issue 2)', () => {
      const graph = new KnowledgeGraph();

      // Concept A: mu near decision boundary (mu=0) => high Fisher info
      graph.addConcept(createConceptNode({
        conceptId: 'near-boundary',
        domain: 'languages',
        specificity: 'topic',
      }));
      const stateA = graph.getUserConceptState('user1', 'near-boundary');
      stateA.mastery.mu = 0.0; // at the middle threshold => high Fisher info
      graph.setUserConceptState('user1', 'near-boundary', stateA);

      // Concept B: mu far from boundary (mu=-3) => low Fisher info
      graph.addConcept(createConceptNode({
        conceptId: 'far-from-boundary',
        domain: 'languages',
        specificity: 'topic',
      }));
      const stateB = graph.getUserConceptState('user1', 'far-from-boundary');
      stateB.mastery.mu = -3.0; // far below all thresholds => low Fisher info
      graph.setUserConceptState('user1', 'far-from-boundary', stateB);

      const frontier = graph.getZPDFrontier('user1');
      expect(frontier.length).toBe(2);
      // The concept near the boundary (mu=0) should come first (higher Fisher info)
      expect(frontier[0]).toBe('near-boundary');
      expect(frontier[1]).toBe('far-from-boundary');
    });

    it('returns empty array when all concepts are mastered', () => {
      const graph = new KnowledgeGraph();
      graph.addConcept(createConceptNode({
        conceptId: 'concept-a',
        domain: 'languages',
        specificity: 'topic',
      }));
      graph.addConcept(createConceptNode({
        conceptId: 'concept-b',
        domain: 'languages',
        specificity: 'topic',
        relationships: [{ target: 'concept-a', type: 'requires' }],
      }));

      // Master both concepts
      const stateA = graph.getUserConceptState('user1', 'concept-a');
      stateA.mastery.mu = 2.0;
      graph.setUserConceptState('user1', 'concept-a', stateA);

      const stateB = graph.getUserConceptState('user1', 'concept-b');
      stateB.mastery.mu = 2.0;
      graph.setUserConceptState('user1', 'concept-b', stateB);

      const frontier = graph.getZPDFrontier('user1');
      expect(frontier).toEqual([]);
    });
  });
});
