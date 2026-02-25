import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handlePostToolUse } from '../../src/hooks/post-tool-use.js';
import { handleUserPromptSubmit } from '../../src/hooks/user-prompt-submit.js';
import { StateManager } from '../../src/core/state-manager.js';

const USER_ID = 'test-user';

function makeHookInput(prompt: string) {
  return {
    session_id: 'tutor-flow-test',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit' as const,
    prompt,
  };
}

function addRedisConcept(sm: StateManager): void {
  sm.getKnowledgeGraph().addConcept({
    conceptId: 'Redis',
    aliases: ['redis'],
    domain: 'databases',
    specificity: 'topic',
    parentConcept: null,
    itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
    relationships: [],
    lifecycle: 'validated',
    populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
  });
}

describe('tutor-flow integration', () => {
  let dataDir: string;
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'entendi-tutor-flow-'));
    dataDir = join(projectDir, '.entendi');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('complete reactive tutor flow: install -> probe -> offer -> 4 phases -> complete', async () => {
    // Step 1: PostToolUse with npm install redis -> creates pending probe
    const postToolResult = await handlePostToolUse(
      {
        session_id: 'tutor-flow-test',
        cwd: projectDir,
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm install redis' },
      },
      { skipLLM: true, dataDir, userId: USER_ID },
    );

    expect(postToolResult).toBeDefined();
    expect(postToolResult!.hookSpecificOutput?.additionalContext).toBeTruthy();

    // Verify pending probe was created
    const sm1 = new StateManager(dataDir, USER_ID);
    const pendingProbe = sm1.getProbeSession().pendingProbe;
    expect(pendingProbe).not.toBeNull();
    const conceptId = pendingProbe!.probe.conceptId;

    // Step 2: UserPromptSubmit with a poor answer -> evaluates probe, offers tutor
    // skipLLM gives rubricScore=1, default tutorTriggerThreshold=1, tutorMode='both'
    // shouldOfferTutor(1, 1, 'both') => 1 <= 1 => true
    const probeResponse = await handleUserPromptSubmit(
      makeHookInput('I dunno, it stores stuff I think?'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(probeResponse).toBeDefined();
    expect(probeResponse!.hookSpecificOutput?.additionalContext).toContain('Would you like me to help');

    // Verify tutor is offered
    const sm2 = new StateManager(dataDir, USER_ID);
    expect(sm2.getTutorSession()).not.toBeNull();
    expect(sm2.getTutorSession()!.phase).toBe('offered');
    expect(sm2.getTutorSession()!.conceptId).toBe(conceptId);

    // Step 3: UserPromptSubmit with "yes" -> accepts, enters phase1
    const acceptResult = await handleUserPromptSubmit(
      makeHookInput('yes'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(acceptResult).toBeDefined();
    expect(acceptResult!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

    const sm3 = new StateManager(dataDir, USER_ID);
    expect(sm3.getTutorSession()!.phase).toBe('phase1');
    expect(sm3.getTutorSession()!.exchanges.length).toBe(1);
    expect(sm3.getTutorSession()!.exchanges[0].response).toBeNull();

    // Step 4: UserPromptSubmit with phase1 answer -> scores, advances to phase2
    const phase1Result = await handleUserPromptSubmit(
      makeHookInput('Redis is a key-value store used for caching'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(phase1Result).toBeDefined();
    expect(phase1Result!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

    const sm4 = new StateManager(dataDir, USER_ID);
    expect(sm4.getTutorSession()!.phase).toBe('phase2');
    expect(sm4.getTutorSession()!.phase1Score).not.toBeNull();

    // Step 5: UserPromptSubmit with phase2 answer -> advances to phase3 (no score)
    const phase2Result = await handleUserPromptSubmit(
      makeHookInput('It uses memory instead of disk for speed'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(phase2Result).toBeDefined();
    expect(phase2Result!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

    const sm5 = new StateManager(dataDir, USER_ID);
    expect(sm5.getTutorSession()!.phase).toBe('phase3');

    // Step 6: UserPromptSubmit with phase3 answer -> advances to phase4
    const phase3Result = await handleUserPromptSubmit(
      makeHookInput('You lose data if it crashes without persistence configured'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(phase3Result).toBeDefined();
    expect(phase3Result!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

    const sm6 = new StateManager(dataDir, USER_ID);
    expect(sm6.getTutorSession()!.phase).toBe('phase4');

    // Step 7: UserPromptSubmit with phase4 answer -> scores (tutored), completes session
    const phase4Result = await handleUserPromptSubmit(
      makeHookInput('Redis is an in-memory data store that trades durability for speed. It supports persistence via AOF and RDB. Great for caching, sessions, and pub/sub.'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(phase4Result).toBeDefined();
    expect(phase4Result!.hookSpecificOutput?.additionalContext).toContain('complete');

    // Verify final state
    const smFinal = new StateManager(dataDir, USER_ID);

    // Tutor session is null (cleared)
    expect(smFinal.getTutorSession()).toBeNull();

    // Knowledge graph has assessments for the concept
    const ucs = smFinal.getKnowledgeGraph().getUserConceptState(USER_ID, conceptId);
    expect(ucs.assessmentCount).toBeGreaterThanOrEqual(2); // probe + phase1 + phase4 = 3 minimum
    expect(ucs.history.length).toBeGreaterThanOrEqual(2);

    // At least one tutored assessment (phase4)
    expect(ucs.tutoredAssessmentCount).toBeGreaterThanOrEqual(1);

    // Verify event types: should have probe, tutor_phase1, tutor_phase4
    const eventTypes = ucs.history.map((h) => h.eventType);
    expect(eventTypes).toContain('probe');
    expect(eventTypes).toContain('tutor_phase1');
    expect(eventTypes).toContain('tutor_phase4');
  });

  it('proactive tutor flow: teach me -> 4 phases -> complete', async () => {
    // Pre-seed a concept (Redis with alias 'redis') via StateManager
    const sm = new StateManager(dataDir, USER_ID);
    addRedisConcept(sm);
    sm.save();

    // Step 1: UserPromptSubmit with "teach me about Redis" -> creates tutor at phase1
    const teachResult = await handleUserPromptSubmit(
      makeHookInput('teach me about Redis'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(teachResult).toBeDefined();
    expect(teachResult!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

    const sm1 = new StateManager(dataDir, USER_ID);
    expect(sm1.getTutorSession()).not.toBeNull();
    expect(sm1.getTutorSession()!.phase).toBe('phase1');
    expect(sm1.getTutorSession()!.conceptId).toBe('Redis');
    expect(sm1.getTutorSession()!.triggerProbeScore).toBeNull();

    // Step 2: Phase1 response
    const phase1Result = await handleUserPromptSubmit(
      makeHookInput('Redis is a key-value store'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(phase1Result).toBeDefined();
    const sm2 = new StateManager(dataDir, USER_ID);
    expect(sm2.getTutorSession()!.phase).toBe('phase2');

    // Step 3: Phase2 response
    const phase2Result = await handleUserPromptSubmit(
      makeHookInput('It is fast because it uses RAM'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(phase2Result).toBeDefined();
    const sm3 = new StateManager(dataDir, USER_ID);
    expect(sm3.getTutorSession()!.phase).toBe('phase3');

    // Step 4: Phase3 response
    const phase3Result = await handleUserPromptSubmit(
      makeHookInput('The trade-off is data volatility without persistence'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(phase3Result).toBeDefined();
    const sm4 = new StateManager(dataDir, USER_ID);
    expect(sm4.getTutorSession()!.phase).toBe('phase4');

    // Step 5: Phase4 response -> completes session
    const phase4Result = await handleUserPromptSubmit(
      makeHookInput('Redis is an in-memory data structure store used as a database, cache, and message broker. It supports various data structures and offers persistence through RDB snapshots and AOF logging.'),
      { dataDir, skipLLM: true, userId: USER_ID },
    );

    expect(phase4Result).toBeDefined();
    expect(phase4Result!.hookSpecificOutput?.additionalContext).toContain('complete');

    // Verify session is cleared
    const smFinal = new StateManager(dataDir, USER_ID);
    expect(smFinal.getTutorSession()).toBeNull();

    // Verify concept has assessments
    const ucs = smFinal.getKnowledgeGraph().getUserConceptState(USER_ID, 'Redis');
    expect(ucs.assessmentCount).toBeGreaterThanOrEqual(2); // phase1 + phase4
    expect(ucs.history.length).toBeGreaterThanOrEqual(2);

    // Verify event types
    const eventTypes = ucs.history.map((h) => h.eventType);
    expect(eventTypes).toContain('tutor_phase1');
    expect(eventTypes).toContain('tutor_phase4');

    // Verify tutored assessment count
    expect(ucs.tutoredAssessmentCount).toBeGreaterThanOrEqual(1);
  });
});
