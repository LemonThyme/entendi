import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../../../src/core/state-manager.js';
import { readPendingAction } from '../../../src/mcp/pending-action.js';
import { handleObserve, type ObserveInput, } from '../../../src/mcp/tools/observe.js';
import { createConceptNode } from '../../../src/schemas/types.js';

describe('entendi_observe', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-observe-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  // --- Helper to add a concept to the knowledge graph ---
  function addConcept(id: string, domain: string = 'databases') {
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: id,
      domain,
      specificity: 'topic',
    }));
    sm.save();
    // Reload state manager to simulate fresh read
    sm = new StateManager(dataDir, userId);
  }

  it('returns shouldProbe=true for a novel concept', () => {
    addConcept('redis/caching');
    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    // Force probe for deterministic testing
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.shouldProbe).toBe(true);
    expect(result.conceptId).toBe('redis/caching');
    expect(result.depth).toBeDefined();
    expect(result.intrusiveness).toBeDefined();
    expect(['direct', 'woven', 'skip']).toContain(result.intrusiveness);
    expect(result.userProfile).toBeDefined();
    expect(['unknown', 'beginner', 'intermediate', 'advanced']).toContain(result.userProfile);
  });

  it('creates concept in knowledge graph if it does not exist', () => {
    const input: ObserveInput = {
      concepts: [{ id: 'brand-new-concept', source: 'ast' }],
      triggerContext: 'npm install something',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.shouldProbe).toBe(true);
    const kg = sm.getKnowledgeGraph();
    expect(kg.getConcept('brand-new-concept')).toBeDefined();
  });

  it('writes pending-action.json when shouldProbe is true', () => {
    addConcept('redis/caching');
    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    handleObserve(input, sm, userId, { forceProbe: true });
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('awaiting_probe_response');
  });

  it('does not write pending-action when shouldProbe is false (routine concept)', () => {
    addConcept('redis/caching');
    // Mark concept as mastered
    const kg = sm.getKnowledgeGraph();
    const ucs = kg.getUserConceptState(userId, 'redis/caching');
    ucs.mastery = { mu: 3.0, sigma: 0.3 };
    ucs.assessmentCount = 10;
    ucs.lastAssessed = new Date().toISOString();
    kg.setUserConceptState(userId, 'redis/caching', ucs);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    // Don't force probe -- let scheduler decide
    const result = handleObserve(input, sm, userId);
    // Routine concept with high mastery should likely be skipped
    if (!result.shouldProbe) {
      expect(readPendingAction(dataDir)).toBeNull();
    }
  });

  it('returns userProfile=unknown when no concepts have been assessed', () => {
    addConcept('redis/caching');
    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.userProfile).toBe('unknown');
  });

  it('returns userProfile=advanced when average mastery is high', () => {
    // Pre-populate with several mastered concepts
    for (const id of ['concept-a', 'concept-b', 'concept-c']) {
      addConcept(id);
      const kg = sm.getKnowledgeGraph();
      const ucs = kg.getUserConceptState(userId, id);
      ucs.mastery = { mu: 3.0, sigma: 0.3 };
      ucs.assessmentCount = 5;
      ucs.lastAssessed = new Date().toISOString();
      kg.setUserConceptState(userId, id, ucs);
      sm.save();
      sm = new StateManager(dataDir, userId);
    }

    addConcept('new-concept');
    const input: ObserveInput = {
      concepts: [{ id: 'new-concept', source: 'package' }],
      triggerContext: 'npm install something',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.userProfile).toBe('advanced');
  });

  it('computes intrusiveness=woven for advanced user with novel concept', () => {
    // Set up an advanced user
    for (const id of ['concept-a', 'concept-b', 'concept-c']) {
      addConcept(id);
      const kg = sm.getKnowledgeGraph();
      const ucs = kg.getUserConceptState(userId, id);
      ucs.mastery = { mu: 3.0, sigma: 0.3 };
      ucs.assessmentCount = 5;
      ucs.lastAssessed = new Date().toISOString();
      kg.setUserConceptState(userId, id, ucs);
      sm.save();
      sm = new StateManager(dataDir, userId);
    }

    addConcept('novel-concept');
    const input: ObserveInput = {
      concepts: [{ id: 'novel-concept', source: 'package' }],
      triggerContext: 'npm install novel-thing',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.intrusiveness).toBe('woven');
  });

  it('selects highest Fisher information concept when multiple provided', () => {
    addConcept('concept-a');
    addConcept('concept-b');
    // concept-b is at prior (mu=0, sigma=1.5) which has higher Fisher info
    // concept-a is partly mastered (mu=2.0) which has lower Fisher info
    const kg = sm.getKnowledgeGraph();
    const ucsA = kg.getUserConceptState(userId, 'concept-a');
    ucsA.mastery = { mu: 2.0, sigma: 0.5 };
    ucsA.assessmentCount = 3;
    ucsA.lastAssessed = new Date().toISOString();
    kg.setUserConceptState(userId, 'concept-a', ucsA);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: ObserveInput = {
      concepts: [
        { id: 'concept-a', source: 'package' },
        { id: 'concept-b', source: 'ast' },
      ],
      triggerContext: 'npm install something',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    // concept-b at prior should have higher info value
    expect(result.conceptId).toBe('concept-b');
  });

  it('returns guidance string when probing', () => {
    addConcept('redis/caching');
    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.shouldProbe).toBe(true);
    expect(result.guidance).toBeDefined();
    expect(typeof result.guidance).toBe('string');
    expect(result.guidance!.length).toBeGreaterThan(0);
  });

  it('respects rate limit: returns shouldProbe=false when probed recently', () => {
    addConcept('redis/caching');

    // Simulate a recent probe by setting lastProbeTime
    const probeSession = sm.getProbeSession();
    probeSession.lastProbeTime = new Date().toISOString();
    probeSession.probesThisSession = 1;
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    // With default minProbeIntervalMinutes=2, a probe just now should be blocked
    const result = handleObserve(input, sm, userId, {
      forceProbe: true,
      config: { minProbeIntervalMinutes: 2, maxProbesPerHour: 15 },
    });
    expect(result.shouldProbe).toBe(false);
  });

  it('returns userProfile=beginner when average mastery is low', () => {
    // Pre-populate with concepts that have low mastery
    for (const id of ['concept-a', 'concept-b']) {
      addConcept(id);
      const kg = sm.getKnowledgeGraph();
      const ucs = kg.getUserConceptState(userId, id);
      ucs.mastery = { mu: -1.0, sigma: 1.0 };
      ucs.assessmentCount = 2;
      ucs.lastAssessed = new Date().toISOString();
      kg.setUserConceptState(userId, id, ucs);
      sm.save();
      sm = new StateManager(dataDir, userId);
    }

    const input: ObserveInput = {
      concepts: [{ id: 'concept-a', source: 'package' }],
      triggerContext: 'npm install something',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.userProfile).toBe('beginner');
  });

  it('returns userProfile=intermediate when average mastery is moderate', () => {
    // Pre-populate with concepts that have moderate mastery
    // pMastery(0.5) = 0.622 which is between 0.4 and 0.75 => intermediate
    for (const id of ['concept-a', 'concept-b']) {
      addConcept(id);
      const kg = sm.getKnowledgeGraph();
      const ucs = kg.getUserConceptState(userId, id);
      ucs.mastery = { mu: 0.5, sigma: 0.5 };
      ucs.assessmentCount = 3;
      ucs.lastAssessed = new Date().toISOString();
      kg.setUserConceptState(userId, id, ucs);
      sm.save();
      sm = new StateManager(dataDir, userId);
    }

    const input: ObserveInput = {
      concepts: [{ id: 'concept-a', source: 'package' }],
      triggerContext: 'npm install something',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.userProfile).toBe('intermediate');
  });

  it('returns intrusiveness=direct for unknown user with novel concept', () => {
    addConcept('redis/caching');
    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    // Unknown user + novel concept = direct
    expect(result.userProfile).toBe('unknown');
    expect(result.intrusiveness).toBe('direct');
  });

  it('respects rate limit: returns shouldProbe=false when maxProbesPerHour exceeded', () => {
    addConcept('redis/caching');

    // Simulate exceeding maxProbesPerHour
    const probeSession = sm.getProbeSession();
    probeSession.probesThisSession = 15;
    probeSession.lastProbeTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago (past interval)
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    const result = handleObserve(input, sm, userId, {
      forceProbe: true,
      config: { minProbeIntervalMinutes: 2, maxProbesPerHour: 15 },
    });
    expect(result.shouldProbe).toBe(false);
  });

  it('returns shouldProbe=false and intrusiveness=skip for routine concept with any user', () => {
    // Routine concept: high mastery, recent assessment, high retrievability
    addConcept('redis/caching');
    const kg = sm.getKnowledgeGraph();
    const ucs = kg.getUserConceptState(userId, 'redis/caching');
    ucs.mastery = { mu: 3.0, sigma: 0.3 };
    ucs.assessmentCount = 10;
    ucs.lastAssessed = new Date().toISOString();
    ucs.memory = { stability: 30.0, difficulty: 3.0 }; // High stability for routine
    kg.setUserConceptState(userId, 'redis/caching', ucs);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    // Routine concept => skip for all user profiles
    expect(result.intrusiveness).toBe('skip');
    expect(result.shouldProbe).toBe(false);
  });

  it('pending action contains the correct conceptId and depth', () => {
    addConcept('express/middleware');
    const input: ObserveInput = {
      concepts: [{ id: 'express/middleware', source: 'package' }],
      triggerContext: 'npm install express',
    };
    handleObserve(input, sm, userId, { forceProbe: true });
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    if (pending && pending.type === 'awaiting_probe_response') {
      expect(pending.conceptId).toBe('express/middleware');
      expect(pending.depth).toBeGreaterThanOrEqual(1);
      expect(pending.depth).toBeLessThanOrEqual(3);
    }
  });

  it('handles empty concepts array gracefully', () => {
    const input: ObserveInput = {
      concepts: [],
      triggerContext: 'npm install something',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.shouldProbe).toBe(false);
    expect(result.intrusiveness).toBe('skip');
  });
});
