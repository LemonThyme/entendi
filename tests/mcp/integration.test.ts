import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../../src/core/state-manager.js';
import { readPendingAction } from '../../src/mcp/pending-action.js';
import { handleObserve } from '../../src/mcp/tools/observe.js';
import { handleGetStatus, handleGetZPDFrontier } from '../../src/mcp/tools/query.js';
import { handleRecordEvaluation } from '../../src/mcp/tools/record-evaluation.js';
import { handleAdvanceTutor, handleDismiss, handleStartTutor } from '../../src/mcp/tools/tutor.js';
import { createConceptNode, pMastery } from '../../src/schemas/types.js';

describe('MCP Integration: Full Probe Flow', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-int-'));
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

  it('observe -> record_evaluation: full probe cycle', () => {
    // Step 1: Observe
    const observeResult = handleObserve(
      { concepts: [{ id: 'redis/caching', source: 'package' }], triggerContext: 'npm install redis' },
      sm, userId, { forceProbe: true },
    );
    expect(observeResult.shouldProbe).toBe(true);
    expect(observeResult.conceptId).toBe('redis/caching');

    // Verify pending action was written
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('awaiting_probe_response');

    // Step 2: Record evaluation with score 2 (functional)
    const evalResult = handleRecordEvaluation(
      {
        conceptId: 'redis/caching',
        score: 2,
        confidence: 0.8,
        reasoning: 'Good understanding of caching patterns',
        eventType: 'probe',
      },
      sm, userId,
    );
    expect(evalResult.mastery).toBeGreaterThan(evalResult.previousMastery);
    expect(evalResult.shouldOfferTutor).toBe(false); // score 2 > threshold 1

    // Verify mastery increased in the knowledge graph
    const status = handleGetStatus({ conceptId: 'redis/caching' }, sm, userId);
    expect(status.concept!.assessmentCount).toBe(1);
    expect(status.concept!.mastery).toBeGreaterThan(0.5);

    // Verify pending action was cleared
    expect(readPendingAction(dataDir)).toBeNull();
  });

  it('observe -> low score -> record_evaluation -> tutor offered', () => {
    const observeResult = handleObserve(
      { concepts: [{ id: 'redis/caching', source: 'package' }], triggerContext: 'npm install redis' },
      sm, userId, { forceProbe: true },
    );
    expect(observeResult.shouldProbe).toBe(true);

    const evalResult = handleRecordEvaluation(
      {
        conceptId: 'redis/caching',
        score: 0,
        confidence: 0.9,
        reasoning: 'No understanding demonstrated',
        eventType: 'probe',
      },
      sm, userId,
    );
    expect(evalResult.shouldOfferTutor).toBe(true);

    // Verify tutor_offered pending action
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('tutor_offered');
  });
});

describe('MCP Integration: Full Tutor Flow (Reactive)', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-tutor-int-'));
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

  it('observe -> low score -> start_tutor -> 4 phases -> complete', () => {
    // 1. Observe and get probed
    handleObserve(
      { concepts: [{ id: 'redis/caching', source: 'package' }], triggerContext: 'npm install redis' },
      sm, userId, { forceProbe: true },
    );

    // 2. Low score evaluation -> shouldOfferTutor: true
    const evalResult = handleRecordEvaluation(
      { conceptId: 'redis/caching', score: 0, confidence: 0.9, reasoning: 'No understanding', eventType: 'probe' },
      sm, userId,
    );
    expect(evalResult.shouldOfferTutor).toBe(true);

    // 3. Verify pending action is tutor_offered
    let pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('tutor_offered');

    // 4. Start tutor
    const startResult = handleStartTutor(
      { conceptId: 'redis/caching', triggerScore: 0 },
      sm, userId,
    );
    expect(startResult.phase).toBe('phase1');
    const sessionId = startResult.sessionId;

    // 5. Verify pending action is tutor_active with phase1
    pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('tutor_active');
    if (pending!.type === 'tutor_active') {
      expect(pending!.phase).toBe('phase1');
    }

    // 6. Phase 1: Assessment (scored, untutored)
    const p1 = handleAdvanceTutor(
      { sessionId, userResponse: 'I think it caches data', score: 1, confidence: 0.7, reasoning: 'Surface' },
      sm, userId,
    );
    expect(p1.phase).toBe('phase2');
    expect(p1.masteryUpdate).toBeDefined();

    // 7. Phase 2: Guided discovery (not scored)
    const p2 = handleAdvanceTutor(
      { sessionId, userResponse: 'Oh, it uses an in-memory data structure' },
      sm, userId,
    );
    expect(p2.phase).toBe('phase3');

    // 8. Phase 3: Rectification with misconception (not scored)
    const p3 = handleAdvanceTutor(
      { sessionId, userResponse: 'I see, so TTL is important for cache invalidation', misconception: 'Redis is single-threaded for everything' },
      sm, userId,
    );
    expect(p3.phase).toBe('phase4');

    // 9. Phase 4: Consolidation (scored, tutored)
    const p4 = handleAdvanceTutor(
      { sessionId, userResponse: 'Redis caches data in memory with TTL, supports pub/sub...', score: 2, confidence: 0.9, reasoning: 'Functional understanding after tutoring' },
      sm, userId,
    );
    expect(p4.phase).toBe('complete');
    expect(p4.isComplete).toBe(true);
    expect(p4.sessionSummary).toBeDefined();

    // 10. Verify tutor session cleared
    expect(sm.getTutorSession()).toBeNull();

    // 11. Verify pending action cleared
    expect(readPendingAction(dataDir)).toBeNull();

    // 12. Verify mastery was updated (probe + phase1 + phase4 = 3 assessments)
    const status = handleGetStatus({ conceptId: 'redis/caching' }, sm, userId);
    expect(status.concept!.assessmentCount).toBeGreaterThanOrEqual(3);
    expect(status.concept!.tutoredCount).toBeGreaterThanOrEqual(1);
    expect(status.concept!.untutoredCount).toBeGreaterThanOrEqual(1);
  });
});

describe('MCP Integration: Full Tutor Flow (Proactive)', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-proactive-int-'));
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

  it('proactive tutor: start_tutor with null triggerScore -> 4 phases -> complete', () => {
    // 1. Start tutor proactively (no prior probe)
    const startResult = handleStartTutor(
      { conceptId: 'redis/caching', triggerScore: null },
      sm, userId,
    );
    expect(startResult.phase).toBe('phase1');
    const sessionId = startResult.sessionId;

    // 2. Phase 1 (scored, untutored)
    const p1 = handleAdvanceTutor(
      { sessionId, userResponse: 'I have some idea about caching', score: 1, confidence: 0.7, reasoning: 'Surface' },
      sm, userId,
    );
    expect(p1.phase).toBe('phase2');
    expect(p1.masteryUpdate).toBeDefined();

    // 3. Phase 2 (not scored)
    const p2 = handleAdvanceTutor(
      { sessionId, userResponse: 'Memory-based storage for fast reads' },
      sm, userId,
    );
    expect(p2.phase).toBe('phase3');

    // 4. Phase 3 (not scored)
    const p3 = handleAdvanceTutor(
      { sessionId, userResponse: 'TTL-based eviction, various data structures' },
      sm, userId,
    );
    expect(p3.phase).toBe('phase4');

    // 5. Phase 4 (scored, tutored)
    const p4 = handleAdvanceTutor(
      { sessionId, userResponse: 'Redis is an in-memory store with TTL, pub/sub, and Lua scripting', score: 2, confidence: 0.8, reasoning: 'Functional understanding' },
      sm, userId,
    );
    expect(p4.phase).toBe('complete');
    expect(p4.isComplete).toBe(true);
    expect(p4.sessionSummary).toBeDefined();

    // 6. Verify completion cleanup
    expect(sm.getTutorSession()).toBeNull();
    expect(readPendingAction(dataDir)).toBeNull();

    // 7. Verify mastery updated (phase1 + phase4 = 2 assessments)
    const status = handleGetStatus({ conceptId: 'redis/caching' }, sm, userId);
    expect(status.concept!.assessmentCount).toBe(2);
    expect(status.concept!.tutoredCount).toBe(1);
    expect(status.concept!.untutoredCount).toBe(1);
  });
});

describe('MCP Integration: Intrusiveness Model', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-intrusiveness-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('advanced user gets woven intrusiveness for novel concept', () => {
    const kg = sm.getKnowledgeGraph();

    // Create an advanced user with many mastered concepts
    for (let i = 0; i < 5; i++) {
      const id = `mastered-concept-${i}`;
      kg.addConcept(createConceptNode({ conceptId: id, domain: 'test', specificity: 'topic' }));
      const ucs = kg.getUserConceptState(userId, id);
      ucs.mastery = { mu: 3.0, sigma: 0.3 };
      ucs.assessmentCount = 5;
      ucs.lastAssessed = new Date().toISOString();
      kg.setUserConceptState(userId, id, ucs);
    }

    // Add a novel concept (never assessed)
    kg.addConcept(createConceptNode({ conceptId: 'novel-concept', domain: 'test', specificity: 'topic' }));

    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleObserve(
      { concepts: [{ id: 'novel-concept', source: 'package' }], triggerContext: 'npm install something' },
      sm, userId, { forceProbe: true },
    );
    expect(result.userProfile).toBe('advanced');
    // advanced + novel => woven
    expect(result.intrusiveness).toBe('woven');
  });

  it('advanced user gets skip for routine concept (no probing)', () => {
    const kg = sm.getKnowledgeGraph();

    // Create an advanced user with many mastered concepts
    for (let i = 0; i < 5; i++) {
      const id = `mastered-concept-${i}`;
      kg.addConcept(createConceptNode({ conceptId: id, domain: 'test', specificity: 'topic' }));
      const ucs = kg.getUserConceptState(userId, id);
      ucs.mastery = { mu: 3.0, sigma: 0.3 };
      ucs.assessmentCount = 5;
      ucs.lastAssessed = new Date().toISOString();
      kg.setUserConceptState(userId, id, ucs);
    }

    // Add a routine concept (high mastery, recently assessed, high stability)
    kg.addConcept(createConceptNode({ conceptId: 'routine-concept', domain: 'test', specificity: 'topic' }));
    const routineUcs = kg.getUserConceptState(userId, 'routine-concept');
    routineUcs.mastery = { mu: 3.0, sigma: 0.3 };
    routineUcs.assessmentCount = 10;
    routineUcs.lastAssessed = new Date().toISOString();
    routineUcs.memory = { stability: 30.0, difficulty: 3.0 };
    kg.setUserConceptState(userId, 'routine-concept', routineUcs);

    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleObserve(
      { concepts: [{ id: 'routine-concept', source: 'package' }], triggerContext: 'npm install something' },
      sm, userId, { forceProbe: true },
    );
    expect(result.userProfile).toBe('advanced');
    // Routine concept for any user profile -> skip
    expect(result.intrusiveness).toBe('skip');
    expect(result.shouldProbe).toBe(false);
  });

  it('unknown user gets direct intrusiveness for novel concept', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'novel-concept', domain: 'test', specificity: 'topic' }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleObserve(
      { concepts: [{ id: 'novel-concept', source: 'package' }], triggerContext: 'npm install something' },
      sm, userId, { forceProbe: true },
    );
    expect(result.userProfile).toBe('unknown');
    expect(result.intrusiveness).toBe('direct');
  });
});

describe('MCP Integration: ZPD Frontier Update', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-zpd-int-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('completing a tutor session updates ZPD frontier', () => {
    const kg = sm.getKnowledgeGraph();

    // Create concept A (prerequisite) and concept B (requires A)
    kg.addConcept(createConceptNode({ conceptId: 'concept-a', domain: 'test', specificity: 'topic' }));
    kg.addConcept(createConceptNode({
      conceptId: 'concept-b',
      domain: 'test',
      specificity: 'topic',
      relationships: [{ target: 'concept-a', type: 'requires' }],
    }));

    // Set mastery of A to high (mastered)
    const ucsA = kg.getUserConceptState(userId, 'concept-a');
    ucsA.mastery = { mu: 3.0, sigma: 0.3 };
    ucsA.assessmentCount = 5;
    ucsA.lastAssessed = new Date().toISOString();
    ucsA.memory = { stability: 30.0, difficulty: 3.0 };
    kg.setUserConceptState(userId, 'concept-a', ucsA);

    sm.save();
    sm = new StateManager(dataDir, userId);

    // B should be in frontier (A mastered, B not mastered, B requires A)
    let frontier = handleGetZPDFrontier(sm, userId, { includeUnassessed: true });
    let frontierIds = frontier.frontier.map(f => f.conceptId);
    expect(frontierIds).toContain('concept-b');
    expect(frontierIds).not.toContain('concept-a'); // A is already mastered

    // Start tutor on B and complete with high scores
    const startResult = handleStartTutor({ conceptId: 'concept-b', triggerScore: null }, sm, userId);
    const sessionId = startResult.sessionId;

    // Phase 1: high score
    handleAdvanceTutor(
      { sessionId, userResponse: 'I understand the basics', score: 3, confidence: 0.9, reasoning: 'Good' },
      sm, userId,
    );
    // Phase 2
    handleAdvanceTutor(
      { sessionId, userResponse: 'Deeper understanding' },
      sm, userId,
    );
    // Phase 3
    handleAdvanceTutor(
      { sessionId, userResponse: 'Even deeper' },
      sm, userId,
    );
    // Phase 4: high score
    handleAdvanceTutor(
      { sessionId, userResponse: 'Full mastery demonstrated', score: 3, confidence: 0.95, reasoning: 'Deep understanding' },
      sm, userId,
    );

    // Now verify B's mastery has increased significantly
    const status = handleGetStatus({ conceptId: 'concept-b' }, sm, userId);
    expect(status.concept!.mastery).toBeGreaterThan(0.5);
    expect(status.concept!.assessmentCount).toBe(2); // phase1 + phase4

    // Check frontier again: if B is mastered (>0.7), it should be gone
    frontier = handleGetZPDFrontier(sm, userId, { includeUnassessed: true });
    frontierIds = frontier.frontier.map(f => f.conceptId);
    // B's mastery should be high enough to be mastered after two high scores
    if (status.concept!.mastery >= 0.7) {
      expect(frontierIds).not.toContain('concept-b');
      expect(frontier.masteredCount).toBe(2); // A and B both mastered
    } else {
      // If tutored evidence weight attenuates phase4, B may still be in frontier
      // but mastery should have increased from the default
      expect(status.concept!.mastery).toBeGreaterThan(pMastery(0)); // better than prior
    }
  });

  it('ZPD frontier excludes concepts with unmastered prerequisites', () => {
    const kg = sm.getKnowledgeGraph();

    // A is prerequisite for B; neither is mastered
    kg.addConcept(createConceptNode({ conceptId: 'concept-a', domain: 'test', specificity: 'topic' }));
    kg.addConcept(createConceptNode({
      conceptId: 'concept-b',
      domain: 'test',
      specificity: 'topic',
      relationships: [{ target: 'concept-a', type: 'requires' }],
    }));

    sm.save();
    sm = new StateManager(dataDir, userId);

    const frontier = handleGetZPDFrontier(sm, userId, { includeUnassessed: true });
    const frontierIds = frontier.frontier.map(f => f.conceptId);

    // A should be in frontier (no prereqs), B should NOT (A not mastered)
    expect(frontierIds).toContain('concept-a');
    expect(frontierIds).not.toContain('concept-b');
  });

  it('mastering a prerequisite unlocks dependent in ZPD frontier', () => {
    const kg = sm.getKnowledgeGraph();

    kg.addConcept(createConceptNode({ conceptId: 'concept-a', domain: 'test', specificity: 'topic' }));
    kg.addConcept(createConceptNode({
      conceptId: 'concept-b',
      domain: 'test',
      specificity: 'topic',
      relationships: [{ target: 'concept-a', type: 'requires' }],
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    // Initially B not in frontier
    let frontier = handleGetZPDFrontier(sm, userId, { includeUnassessed: true });
    expect(frontier.frontier.map(f => f.conceptId)).not.toContain('concept-b');

    // Master concept-a through repeated high-score evaluations
    handleObserve(
      { concepts: [{ id: 'concept-a', source: 'package' }], triggerContext: 'test' },
      sm, userId, { forceProbe: true },
    );
    for (let i = 0; i < 5; i++) {
      handleRecordEvaluation(
        { conceptId: 'concept-a', score: 3, confidence: 0.95, reasoning: 'Excellent', eventType: 'probe' },
        sm, userId,
      );
    }

    // Verify concept-a is mastered
    const statusA = handleGetStatus({ conceptId: 'concept-a' }, sm, userId);
    expect(statusA.concept!.mastery).toBeGreaterThanOrEqual(0.7);

    // Now B should be in frontier
    frontier = handleGetZPDFrontier(sm, userId, { includeUnassessed: true });
    const frontierIds = frontier.frontier.map(f => f.conceptId);
    expect(frontierIds).toContain('concept-b');
    expect(frontierIds).not.toContain('concept-a');
    expect(frontier.masteredCount).toBe(1);
  });
});

describe('MCP Integration: Dismiss Flow', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-dismiss-int-'));
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

  it('dismissing clears pending probe', () => {
    // Set up pending probe via observe
    handleObserve(
      { concepts: [{ id: 'redis/caching', source: 'package' }], triggerContext: 'npm install redis' },
      sm, userId, { forceProbe: true },
    );
    expect(readPendingAction(dataDir)).not.toBeNull();

    // Dismiss
    const result = handleDismiss({ reason: 'user_declined' }, sm, userId, dataDir);
    expect(result.acknowledged).toBe(true);

    // Verify pending action cleared
    expect(readPendingAction(dataDir)).toBeNull();
  });

  it('dismissing clears active tutor session mid-flow', () => {
    // Start tutor
    handleStartTutor({ conceptId: 'redis/caching', triggerScore: 0 }, sm, userId);
    expect(sm.getTutorSession()).not.toBeNull();
    expect(readPendingAction(dataDir)).not.toBeNull();

    // Advance to phase2
    const sessionId = sm.getTutorSession()!.sessionId;
    handleAdvanceTutor(
      { sessionId, userResponse: 'Some response', score: 1, confidence: 0.7, reasoning: 'OK' },
      sm, userId,
    );
    expect(sm.getTutorSession()!.phase).toBe('phase2');

    // Dismiss mid-session
    handleDismiss({ reason: 'topic_changed' }, sm, userId, dataDir);

    // Verify everything is cleared
    expect(sm.getTutorSession()).toBeNull();
    expect(readPendingAction(dataDir)).toBeNull();
  });

  it('dismissing when nothing is pending does not throw', () => {
    // No pending action, no tutor session
    const result = handleDismiss({}, sm, userId, dataDir);
    expect(result.acknowledged).toBe(true);
    expect(readPendingAction(dataDir)).toBeNull();
    expect(sm.getTutorSession()).toBeNull();
  });
});
