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
  createInitialMastery,
  createInitialMemory,
  createUserConceptState,
  createEmptyGraphState,
  pMastery,
  DEFAULT_GRM_PARAMS,
  createConceptNode,
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
});
