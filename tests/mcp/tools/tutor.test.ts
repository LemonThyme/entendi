import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  handleStartTutor,
  handleAdvanceTutor,
  handleDismiss,
  type StartTutorInput,
  type AdvanceTutorInput,
  type DismissInput,
} from '../../../src/mcp/tools/tutor.js';
import { StateManager } from '../../../src/core/state-manager.js';
import { createConceptNode, pMastery } from '../../../src/schemas/types.js';
import { readPendingAction, writePendingAction } from '../../../src/mcp/pending-action.js';

describe('entendi_start_tutor', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-tutor-'));
    sm = new StateManager(dataDir, userId);
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates a tutor session at phase1', () => {
    const input: StartTutorInput = {
      conceptId: 'redis/caching',
      triggerScore: 0,
    };
    const result = handleStartTutor(input, sm, userId);
    expect(result.sessionId).toMatch(/^tutor_/);
    expect(result.phase).toBe('phase1');
    expect(result.guidance).toBeDefined();
    expect(typeof result.guidance).toBe('string');
  });

  it('sets tutor session in state manager', () => {
    const input: StartTutorInput = { conceptId: 'redis/caching', triggerScore: 1 };
    const result = handleStartTutor(input, sm, userId);
    const session = sm.getTutorSession();
    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe(result.sessionId);
    expect(session!.phase).toBe('phase1');
  });

  it('writes tutor_active pending action', () => {
    const input: StartTutorInput = { conceptId: 'redis/caching', triggerScore: 0 };
    handleStartTutor(input, sm, userId);
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('tutor_active');
  });

  it('supports proactive start (null triggerScore)', () => {
    const input: StartTutorInput = { conceptId: 'redis/caching', triggerScore: null };
    const result = handleStartTutor(input, sm, userId);
    expect(result.sessionId).toBeDefined();
    expect(result.phase).toBe('phase1');
  });

  it('checks ZPD prerequisites and suggests if needed', () => {
    // Add a prerequisite concept that is not mastered
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({
      conceptId: 'networking/tcp',
      domain: 'networking',
      specificity: 'topic',
    }));
    // Update redis to require networking/tcp
    const redisConcept = kg.getConcept('redis/caching')!;
    redisConcept.relationships = [{ target: 'networking/tcp', type: 'requires' }];
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: StartTutorInput = { conceptId: 'redis/caching', triggerScore: 0 };
    const result = handleStartTutor(input, sm, userId);
    // Should still create the session but suggest prerequisites
    expect(result.sessionId).toBeDefined();
    if (result.prerequisiteSuggestion) {
      expect(result.prerequisiteSuggestion).toContain('networking/tcp');
    }
  });

  it('returns phase1-specific guidance mentioning the concept', () => {
    const result = handleStartTutor({ conceptId: 'redis/caching', triggerScore: 0 }, sm, userId);
    expect(result.guidance).toContain('redis/caching');
  });

  it('does not suggest prerequisites when all are mastered', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({
      conceptId: 'networking/tcp',
      domain: 'networking',
      specificity: 'topic',
    }));
    // Set networking/tcp as mastered
    const prereqState = kg.getUserConceptState(userId, 'networking/tcp');
    prereqState.mastery = { mu: 3.0, sigma: 0.5 }; // high mastery
    kg.setUserConceptState(userId, 'networking/tcp', prereqState);

    // Set redis to require networking/tcp
    const redisConcept = kg.getConcept('redis/caching')!;
    redisConcept.relationships = [{ target: 'networking/tcp', type: 'requires' }];
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleStartTutor({ conceptId: 'redis/caching', triggerScore: 0 }, sm, userId);
    expect(result.prerequisiteSuggestion).toBeUndefined();
  });
});

describe('entendi_advance_tutor', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';
  let sessionId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-advance-'));
    sm = new StateManager(dataDir, userId);
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    // Start a tutor session
    const startResult = handleStartTutor(
      { conceptId: 'redis/caching', triggerScore: 0 },
      sm,
      userId,
    );
    sessionId = startResult.sessionId;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('advances from phase1 to phase2 with score', () => {
    const input: AdvanceTutorInput = {
      sessionId,
      userResponse: 'Redis is a key-value store used for caching',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface understanding',
    };
    const result = handleAdvanceTutor(input, sm, userId);
    expect(result.phase).toBe('phase2');
    expect(result.isComplete).toBe(false);
    expect(result.guidance).toBeDefined();
  });

  it('advances from phase2 to phase3 without score', () => {
    // Phase 1 -> Phase 2
    handleAdvanceTutor({
      sessionId,
      userResponse: 'I know the basics',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface',
    }, sm, userId);

    // Phase 2 -> Phase 3
    const result = handleAdvanceTutor({
      sessionId,
      userResponse: 'It uses an event loop for I/O',
      misconception: 'Redis is single-threaded for all operations',
    }, sm, userId);
    expect(result.phase).toBe('phase3');
    expect(result.isComplete).toBe(false);
  });

  it('advances through all 4 phases to complete', () => {
    // Phase 1 -> Phase 2
    handleAdvanceTutor({
      sessionId,
      userResponse: 'I know some things',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface',
    }, sm, userId);

    // Phase 2 -> Phase 3
    handleAdvanceTutor({
      sessionId,
      userResponse: 'Redis is fast because of memory',
    }, sm, userId);

    // Phase 3 -> Phase 4
    handleAdvanceTutor({
      sessionId,
      userResponse: 'I see, it uses pipelining too',
    }, sm, userId);

    // Phase 4 -> Complete
    const result = handleAdvanceTutor({
      sessionId,
      userResponse: 'Redis caches data in memory with TTL-based eviction',
      score: 3,
      confidence: 0.9,
      reasoning: 'Deep understanding after tutoring',
    }, sm, userId);
    expect(result.phase).toBe('complete');
    expect(result.isComplete).toBe(true);
    expect(result.sessionSummary).toBeDefined();
  });

  it('performs mastery update on phase1 (untutored) and phase4 (tutored)', () => {
    // Phase 1 (untutored assessment)
    handleAdvanceTutor({
      sessionId,
      userResponse: 'I know some things',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface',
    }, sm, userId);

    const ucsAfterP1 = sm.getKnowledgeGraph().getUserConceptState(userId, 'redis/caching');
    expect(ucsAfterP1.assessmentCount).toBe(1);
    expect(ucsAfterP1.untutoredAssessmentCount).toBe(1);

    // Phase 2 -> Phase 3 -> Phase 4 (no scoring)
    handleAdvanceTutor({ sessionId, userResponse: 'Learned more' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'Understanding deepens' }, sm, userId);

    // Phase 4 (tutored assessment)
    handleAdvanceTutor({
      sessionId,
      userResponse: 'Full explanation',
      score: 3,
      confidence: 0.9,
      reasoning: 'Deep',
    }, sm, userId);

    const ucsAfterP4 = sm.getKnowledgeGraph().getUserConceptState(userId, 'redis/caching');
    expect(ucsAfterP4.assessmentCount).toBe(2);
    expect(ucsAfterP4.tutoredAssessmentCount).toBe(1);
  });

  it('updates pending action on each phase advance', () => {
    handleAdvanceTutor({
      sessionId,
      userResponse: 'Response',
      score: 1,
      confidence: 0.7,
      reasoning: 'OK',
    }, sm, userId);

    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('tutor_active');
    if (pending!.type === 'tutor_active') {
      expect(pending!.phase).toBe('phase2');
    }
  });

  it('clears pending action on completion', () => {
    // Go through all 4 phases
    handleAdvanceTutor({ sessionId, userResponse: 'P1', score: 1, confidence: 0.7, reasoning: 'OK' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P2' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P3' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P4', score: 3, confidence: 0.9, reasoning: 'Good' }, sm, userId);

    const pending = readPendingAction(dataDir);
    expect(pending).toBeNull();
  });

  it('returns masteryUpdate with before/after on scored phases', () => {
    const result = handleAdvanceTutor({
      sessionId,
      userResponse: 'My response',
      score: 2,
      confidence: 0.8,
      reasoning: 'Functional understanding',
    }, sm, userId);
    expect(result.masteryUpdate).toBeDefined();
    expect(typeof result.masteryUpdate!.before).toBe('number');
    expect(typeof result.masteryUpdate!.after).toBe('number');
  });

  it('stores misconception on session for forwarding to phase3', () => {
    // Phase 1 -> Phase 2
    handleAdvanceTutor({
      sessionId,
      userResponse: 'Basics',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface',
    }, sm, userId);

    // Phase 2 -> Phase 3 with misconception
    handleAdvanceTutor({
      sessionId,
      userResponse: 'Redis is single-threaded',
      misconception: 'Redis is single-threaded for all operations',
    }, sm, userId);

    // Verify phase3 guidance references the misconception
    const session = sm.getTutorSession();
    expect(session).not.toBeNull();
    expect(session!.lastMisconception).toBe('Redis is single-threaded for all operations');
  });

  it('provides phase-specific guidance for each phase', () => {
    // Phase 1 -> Phase 2: guidance should mention gaps
    const r1 = handleAdvanceTutor({
      sessionId,
      userResponse: 'I know the basics',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface',
    }, sm, userId);
    expect(r1.guidance).toContain('redis/caching');

    // Phase 2 -> Phase 3: guidance should be about deepening/misconceptions
    const r2 = handleAdvanceTutor({
      sessionId,
      userResponse: 'More detail',
    }, sm, userId);
    expect(r2.guidance).toBeDefined();
    expect(r2.guidance!.length).toBeGreaterThan(0);

    // Phase 3 -> Phase 4: guidance should mention final assessment
    const r3 = handleAdvanceTutor({
      sessionId,
      userResponse: 'I see',
    }, sm, userId);
    expect(r3.guidance).toContain('final assessment');
  });

  it('returns session summary with phase scores on completion', () => {
    handleAdvanceTutor({ sessionId, userResponse: 'P1', score: 1, confidence: 0.7, reasoning: 'OK' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P2' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P3' }, sm, userId);

    const result = handleAdvanceTutor({
      sessionId,
      userResponse: 'P4',
      score: 3,
      confidence: 0.9,
      reasoning: 'Good',
    }, sm, userId);

    expect(result.sessionSummary).toContain('Phase 1 score');
    expect(result.sessionSummary).toContain('Phase 4 score');
    expect(result.sessionSummary).toContain('redis/caching');
  });

  it('clears tutor session from state manager on completion', () => {
    handleAdvanceTutor({ sessionId, userResponse: 'P1', score: 1, confidence: 0.7, reasoning: 'OK' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P2' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P3' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P4', score: 3, confidence: 0.9, reasoning: 'Good' }, sm, userId);

    expect(sm.getTutorSession()).toBeNull();
  });

  it('throws when session id does not match', () => {
    expect(() => handleAdvanceTutor({
      sessionId: 'wrong_id',
      userResponse: 'test',
    }, sm, userId)).toThrow(/No active tutor session/);
  });
});

describe('entendi_dismiss', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-dismiss-'));
    sm = new StateManager(dataDir, userId);
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('clears pending action file', () => {
    writePendingAction(dataDir, {
      type: 'awaiting_probe_response',
      conceptId: 'redis/caching',
      depth: 1,
      timestamp: new Date().toISOString(),
    });
    const result = handleDismiss({ reason: 'user_declined' }, sm, userId, dataDir);
    expect(result.acknowledged).toBe(true);
    expect(readPendingAction(dataDir)).toBeNull();
  });

  it('clears active tutor session', () => {
    handleStartTutor({ conceptId: 'redis/caching', triggerScore: 0 }, sm, userId);
    expect(sm.getTutorSession()).not.toBeNull();

    handleDismiss({ reason: 'user_declined' }, sm, userId, dataDir);
    expect(sm.getTutorSession()).toBeNull();
  });

  it('clears pending probe from probe session', () => {
    sm.setPendingProbe({
      probe: {
        probeId: 'probe_123',
        conceptId: 'redis/caching',
        question: 'Test?',
        depth: 0,
        probeType: 'why',
      },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    sm.save();

    handleDismiss({ reason: 'topic_changed' }, sm, userId, dataDir);
    expect(sm.getProbeSession().pendingProbe).toBeNull();
  });

  it('does not throw when nothing is pending', () => {
    const result = handleDismiss({}, sm, userId, dataDir);
    expect(result.acknowledged).toBe(true);
  });
});
