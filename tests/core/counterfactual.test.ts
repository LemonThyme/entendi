import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleUserPromptSubmit } from '../../src/hooks/user-prompt-submit.js';
import { StateManager } from '../../src/core/state-manager.js';
import { createTutorSession, createTutorExchange } from '../../src/schemas/types.js';
import type { RubricScore } from '../../src/schemas/types.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('counterfactual tracking', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-cf-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function setupConcept(sm: StateManager) {
    sm.getKnowledgeGraph().addConcept({
      conceptId: 'Redis', aliases: [], domain: 'databases', specificity: 'topic',
      parentConcept: null, itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
      relationships: [], lifecycle: 'validated',
      populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
    });
  }

  it('untutored probe updates both mu and muUntutored', async () => {
    const sm = new StateManager(dataDir, 'default');
    setupConcept(sm);
    sm.setPendingProbe({
      probe: { probeId: 'p1', conceptId: 'Redis', question: 'Why?', depth: 0, probeType: 'why' },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    sm.save();

    await handleUserPromptSubmit(
      { session_id: 'test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'For caching' },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    const sm2 = new StateManager(dataDir, 'default');
    const ucs = sm2.getKnowledgeGraph().getUserConceptState('default', 'Redis');
    expect(ucs.mastery.mu).not.toBe(0);
    expect(ucs.muUntutored).not.toBe(0);
    // Both should have the same value for untutored probes
    expect(ucs.muUntutored).toBe(ucs.mastery.mu);
    expect(ucs.untutoredAssessmentCount).toBe(1);
    expect(ucs.tutoredAssessmentCount).toBe(0);
  });

  it('tutor phase1 updates BOTH mu and muUntutored (pre-teaching evidence)', async () => {
    const sm = new StateManager(dataDir, 'default');
    setupConcept(sm);
    const session = createTutorSession('Redis', 1 as RubricScore);
    session.phase = 'phase1';
    session.exchanges = [createTutorExchange('phase1', 'What do you know about Redis?')];
    sm.setTutorSession(session);
    sm.save();

    await handleUserPromptSubmit(
      { session_id: 'test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'It is a cache' },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    const sm2 = new StateManager(dataDir, 'default');
    const ucs = sm2.getKnowledgeGraph().getUserConceptState('default', 'Redis');
    expect(ucs.mastery.mu).not.toBe(0);
    expect(ucs.muUntutored).not.toBe(0);
    expect(ucs.muUntutored).toBe(ucs.mastery.mu);
    expect(ucs.untutoredAssessmentCount).toBe(1);
  });

  it('tutored phase4 updates mu but NOT muUntutored', async () => {
    const sm = new StateManager(dataDir, 'default');
    setupConcept(sm);
    const session = createTutorSession('Redis', 1 as RubricScore);
    session.phase = 'phase4';
    session.phase1Score = 1 as RubricScore;
    session.exchanges = [
      { phase: 'phase1', question: 'Know?', response: 'Cache' },
      { phase: 'phase2', question: 'Persist?', response: 'RDB' },
      { phase: 'phase3', question: 'AOF?', response: 'Append' },
      { phase: 'phase4', question: 'Full picture?', response: null },
    ];
    sm.setTutorSession(session);
    sm.save();

    await handleUserPromptSubmit(
      { session_id: 'test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'Redis is a KV store with RDB and AOF persistence' },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    const sm2 = new StateManager(dataDir, 'default');
    const ucs = sm2.getKnowledgeGraph().getUserConceptState('default', 'Redis');
    expect(ucs.mastery.mu).not.toBe(0);
    expect(ucs.muUntutored).toBe(0); // Shadow NOT updated for phase4
    expect(ucs.sigmaUntutored).toBe(1.5); // Still at initial
    expect(ucs.tutoredAssessmentCount).toBe(1);
    expect(ucs.untutoredAssessmentCount).toBe(0);
  });

  it('phase4 applies tutoredEvidenceWeight attenuation', async () => {
    const sm = new StateManager(dataDir, 'default');
    setupConcept(sm);

    // First do a regular probe to establish a baseline
    sm.setPendingProbe({
      probe: { probeId: 'p1', conceptId: 'Redis', question: 'Why?', depth: 0, probeType: 'why' },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    sm.save();

    await handleUserPromptSubmit(
      { session_id: 'test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'For caching' },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    // Record the post-probe mastery
    const sm2 = new StateManager(dataDir, 'default');
    const afterProbe = sm2.getKnowledgeGraph().getUserConceptState('default', 'Redis');
    const muAfterProbe = afterProbe.mastery.mu;

    // Now do a phase4 tutored assessment
    const session = createTutorSession('Redis', 1 as RubricScore);
    session.phase = 'phase4';
    session.phase1Score = 1 as RubricScore;
    session.exchanges = [
      { phase: 'phase1', question: 'Know?', response: 'Cache' },
      { phase: 'phase2', question: 'Persist?', response: 'RDB' },
      { phase: 'phase3', question: 'AOF?', response: 'Append' },
      { phase: 'phase4', question: 'Full picture?', response: null },
    ];
    sm2.setTutorSession(session);
    sm2.save();

    await handleUserPromptSubmit(
      { session_id: 'test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'Redis is a KV store' },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    const sm3 = new StateManager(dataDir, 'default');
    const afterTutor = sm3.getKnowledgeGraph().getUserConceptState('default', 'Redis');
    // The phase4 update should be attenuated (not as large as a full update)
    // mu should have changed from the post-probe value
    expect(afterTutor.mastery.mu).not.toBe(muAfterProbe);
    // muUntutored should still match the probe value (not updated by phase4)
    expect(afterTutor.muUntutored).toBe(muAfterProbe);
  });
});
