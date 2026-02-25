import { describe, it, expect } from 'vitest';
import {
  type MasteryState,
  type MemoryState,
  type ConceptNode,
  type KnowledgeGraphState,
  type ObservationEvent,
  type GRMItemParams,
  type PopulationStats,
  type TaxonomySeedEntry,
  type RubricScore,
  createInitialMastery,
  createInitialMemory,
  createUserConceptState,
  createEmptyGraphState,
  pMastery,
  DEFAULT_GRM_PARAMS,
  createConceptNode,
  createTutorSession,
  createTutorExchange,
} from '../../src/schemas/types.js';

describe('types', () => {
  it('creates initial mastery state with correct defaults', () => {
    const m = createInitialMastery();
    expect(m.mu).toBe(0.0);
    expect(m.sigma).toBe(1.5);
  });

  it('creates initial memory state with correct defaults', () => {
    const mem = createInitialMemory();
    expect(mem.stability).toBe(1.0);
    expect(mem.difficulty).toBe(5.0);
  });

  it('computes p_mastery from mu via logistic', () => {
    expect(pMastery(0)).toBeCloseTo(0.5, 5);
    expect(pMastery(2)).toBeCloseTo(0.8808, 3);
    expect(pMastery(-2)).toBeCloseTo(0.1192, 3);
  });

  it('createConceptNode creates a valid concept with defaults', () => {
    const node = createConceptNode({
      conceptId: 'async-programming',
      domain: 'programming-languages',
      specificity: 'topic',
    });
    expect(node.conceptId).toBe('async-programming');
    expect(node.domain).toBe('programming-languages');
    expect(node.specificity).toBe('topic');
    expect(node.aliases).toEqual([]);
    expect(node.parentConcept).toBeNull();
    expect(node.itemParams).toEqual(DEFAULT_GRM_PARAMS);
    expect(node.relationships).toEqual([]);
    expect(node.lifecycle).toBe('discovered');
    expect(node.populationStats).toEqual({
      meanMastery: 0,
      assessmentCount: 0,
      failureRate: 0,
    });
  });

  it('createConceptNode accepts overrides', () => {
    const node = createConceptNode({
      conceptId: 'react-hooks',
      domain: 'frontend',
      specificity: 'technique',
      aliases: ['React Hooks', 'Hooks'],
      parentConcept: 'react',
      lifecycle: 'stable',
    });
    expect(node.aliases).toEqual(['React Hooks', 'Hooks']);
    expect(node.parentConcept).toBe('react');
    expect(node.lifecycle).toBe('stable');
  });

  it('PopulationStats type has correct shape', () => {
    const stats: PopulationStats = {
      meanMastery: 0.75,
      assessmentCount: 42,
      failureRate: 0.15,
    };
    expect(stats.meanMastery).toBe(0.75);
  });

  it('createUserConceptState initializes tutored/untutored tracking fields', () => {
    const ucs = createUserConceptState('async-await', 'user1');
    expect(ucs.tutoredAssessmentCount).toBe(0);
    expect(ucs.untutoredAssessmentCount).toBe(0);
    expect(ucs.muUntutored).toBe(0.0);
    expect(ucs.sigmaUntutored).toBe(1.5);
  });
});

describe('TutorSession', () => {
  it('createTutorSession returns correct structure with reactive trigger', () => {
    const session = createTutorSession('async-await', 1 as RubricScore);
    expect(session.sessionId).toMatch(/^tutor_/);
    expect(session.conceptId).toBe('async-await');
    expect(session.phase).toBe('offered');
    expect(session.triggerProbeScore).toBe(1);
    expect(session.exchanges).toEqual([]);
    expect(session.phase1Score).toBeNull();
    expect(session.phase4Score).toBeNull();
    expect(session.startedAt).toBeTruthy();
  });

  it('createTutorSession with null triggerProbeScore works (proactive)', () => {
    const session = createTutorSession('react-hooks', null);
    expect(session.sessionId).toMatch(/^tutor_/);
    expect(session.conceptId).toBe('react-hooks');
    expect(session.phase).toBe('offered');
    expect(session.triggerProbeScore).toBeNull();
    expect(session.exchanges).toEqual([]);
    expect(session.phase1Score).toBeNull();
    expect(session.phase4Score).toBeNull();
  });

  it('createTutorExchange returns correct phase, question, null response', () => {
    const exchange = createTutorExchange('phase2', 'What happens if you forget await?');
    expect(exchange.phase).toBe('phase2');
    expect(exchange.question).toBe('What happens if you forget await?');
    expect(exchange.response).toBeNull();
  });
});
