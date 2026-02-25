import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../src/core/state-manager.js';
import { createTutorSession } from '../../src/schemas/types.js';
import type { RubricScore } from '../../src/schemas/types.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('StateManager', () => {
  let dataDir: string;
  let sm: StateManager;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-test-'));
    sm = new StateManager(dataDir, 'test-user');
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('persists and loads knowledge graph', () => {
    sm.getKnowledgeGraph().addConcept({
      conceptId: 'redis',
      aliases: [],
      domain: 'databases',
      specificity: 'topic',
      parentConcept: null,
      itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
      relationships: [],
      lifecycle: 'validated',
      populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
    });
    sm.save();

    const sm2 = new StateManager(dataDir, 'test-user');
    expect(sm2.getKnowledgeGraph().getConcept('redis')).toBeDefined();
  });

  it('manages probe session state', () => {
    expect(sm.getProbeSession().pendingProbe).toBeNull();

    sm.setPendingProbe({
      probe: {
        probeId: 'p1',
        conceptId: 'redis',
        question: 'Why Redis?',
        depth: 0,
        probeType: 'why',
      },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });

    expect(sm.getProbeSession().pendingProbe).toBeDefined();
    expect(sm.getProbeSession().pendingProbe!.probe.question).toBe('Why Redis?');
  });

  it('clears pending probe', () => {
    sm.setPendingProbe({
      probe: {
        probeId: 'p1',
        conceptId: 'redis',
        question: 'Why Redis?',
        depth: 0,
        probeType: 'why',
      },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    sm.clearPendingProbe();
    expect(sm.getProbeSession().pendingProbe).toBeNull();
  });

  it('persists probe session state', () => {
    sm.setPendingProbe({
      probe: {
        probeId: 'p1',
        conceptId: 'redis',
        question: 'Why Redis?',
        depth: 0,
        probeType: 'why',
      },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    sm.save();

    const sm2 = new StateManager(dataDir, 'test-user');
    expect(sm2.getProbeSession().pendingProbe).toBeDefined();
  });

  it('increments probesThisSession counter', () => {
    sm.setPendingProbe({
      probe: { probeId: 'p1', conceptId: 'redis', question: 'Why?', depth: 0, probeType: 'why' },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    expect(sm.getProbeSession().probesThisSession).toBe(1);

    sm.clearPendingProbe();
    sm.setPendingProbe({
      probe: { probeId: 'p2', conceptId: 'express', question: 'Why?', depth: 0, probeType: 'why' },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install express',
      previousResponses: [],
    });
    expect(sm.getProbeSession().probesThisSession).toBe(2);
  });

  describe('tutor session persistence', () => {
    it('returns null tutor session by default', () => {
      expect(sm.getTutorSession()).toBeNull();
    });

    it('stores and retrieves tutor session', () => {
      const session = createTutorSession('redis', 1 as RubricScore);
      sm.setTutorSession(session);
      sm.save();

      const sm2 = new StateManager(dataDir, 'test-user');
      const loaded = sm2.getTutorSession();
      expect(loaded).not.toBeNull();
      expect(loaded!.conceptId).toBe('redis');
      expect(loaded!.phase).toBe('offered');
    });

    it('clears tutor session', () => {
      const session = createTutorSession('express', 0 as RubricScore);
      sm.setTutorSession(session);
      sm.save();

      const sm2 = new StateManager(dataDir, 'test-user');
      expect(sm2.getTutorSession()).not.toBeNull();

      sm2.clearTutorSession();
      sm2.save();

      const sm3 = new StateManager(dataDir, 'test-user');
      expect(sm3.getTutorSession()).toBeNull();
    });
  });
});
