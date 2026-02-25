import { describe, it, expect } from 'vitest';
import {
  type MasteryState,
  type MemoryState,
  type ConceptNode,
  type KnowledgeGraphState,
  type ObservationEvent,
  type GRMItemParams,
  createInitialMastery,
  createInitialMemory,
  pMastery,
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
});
