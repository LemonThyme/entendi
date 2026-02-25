import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleUserPromptSubmit, detectTeachMePattern } from '../../src/hooks/user-prompt-submit.js';
import { StateManager } from '../../src/core/state-manager.js';
import { createTutorSession, createTutorExchange } from '../../src/schemas/types.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

function makeInput(prompt: string) {
  return {
    session_id: 'test',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit' as const,
    prompt,
  };
}

const defaultOpts = (dataDir: string) => ({
  dataDir,
  skipLLM: true,
  userId: 'default',
});

describe('handleUserPromptSubmit', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-test-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns null when no probe is pending', async () => {
    const result = await handleUserPromptSubmit(
      { session_id: 'test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'hello' },
      { dataDir, skipLLM: true, userId: 'default' },
    );
    expect(result).toBeNull();
  });

  it('captures probe response when probe is pending', async () => {
    const sm = new StateManager(dataDir, 'default');
    sm.setPendingProbe({
      probe: {
        probeId: 'p1',
        conceptId: 'Redis',
        question: 'Why Redis?',
        depth: 0,
        probeType: 'why',
      },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    sm.save();

    const result = await handleUserPromptSubmit(
      { session_id: 'test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'I use Redis for caching API responses' },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    expect(result).toBeDefined();
    expect(result!.hookSpecificOutput?.additionalContext).toContain('Entendi');
  });

  it('updates knowledge graph after evaluation', async () => {
    const sm = new StateManager(dataDir, 'default');
    addRedisConcept(sm);
    sm.setPendingProbe({
      probe: {
        probeId: 'p1',
        conceptId: 'Redis',
        question: 'Why Redis?',
        depth: 0,
        probeType: 'why',
      },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    sm.save();

    await handleUserPromptSubmit(
      { session_id: 'test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'Redis is for in-memory caching' },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    const sm2 = new StateManager(dataDir, 'default');
    const state = sm2.getKnowledgeGraph().getUserConceptState('default', 'Redis');
    expect(state.assessmentCount).toBe(1);
    expect(state.history.length).toBe(1);
  });

  it('uses GRM update for scoring (verifiable by mastery change)', async () => {
    const sm = new StateManager(dataDir, 'default');
    addRedisConcept(sm);
    sm.setPendingProbe({
      probe: {
        probeId: 'p1',
        conceptId: 'Redis',
        question: 'Why Redis?',
        depth: 0,
        probeType: 'why',
      },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    sm.save();

    await handleUserPromptSubmit(
      { session_id: 'test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'Redis is an in-memory cache' },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    const sm2 = new StateManager(dataDir, 'default');
    const state = sm2.getKnowledgeGraph().getUserConceptState('default', 'Redis');
    // GRM update should have modified mastery from default (mu=0, sigma=1.5)
    // skipLLM gives rubricScore=1, which should shift mu
    expect(state.mastery.mu).not.toBe(0);
    expect(state.mastery.sigma).toBeLessThan(1.5); // gained information
  });

  it('clears pending probe after evaluation', async () => {
    const sm = new StateManager(dataDir, 'default');
    sm.setPendingProbe({
      probe: {
        probeId: 'p1',
        conceptId: 'Redis',
        question: 'Why Redis?',
        depth: 0,
        probeType: 'why',
      },
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
    expect(sm2.getProbeSession().pendingProbe).toBeNull();
  });

  describe('tutor integration', () => {
    it('offers tutor when probe score is below threshold', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);
      sm.setPendingProbe({
        probe: {
          probeId: 'p1',
          conceptId: 'Redis',
          question: 'Why Redis?',
          depth: 0,
          probeType: 'why',
        },
        triggeredAt: new Date().toISOString(),
        triggerContext: 'npm install redis',
        previousResponses: [],
      });
      sm.save();

      // skipLLM gives rubricScore=1, default threshold is 1, tutorMode is 'both'
      // shouldOfferTutor(1, 1, 'both') => 1 <= 1 => true
      const result = await handleUserPromptSubmit(
        makeInput('I dunno, it caches stuff?'),
        defaultOpts(dataDir),
      );

      expect(result).toBeDefined();
      expect(result!.hookSpecificOutput?.additionalContext).toContain('Would you like me to help');

      // Verify tutor session was created
      const sm2 = new StateManager(dataDir, 'default');
      const session = sm2.getTutorSession();
      expect(session).not.toBeNull();
      expect(session!.phase).toBe('offered');
      expect(session!.conceptId).toBe('Redis');
    });

    it('accepts tutor offer', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);
      const session = createTutorSession('Redis', 1 as any);
      // session.phase is 'offered' by default
      sm.setTutorSession(session);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('yes'),
        defaultOpts(dataDir),
      );

      expect(result).toBeDefined();
      expect(result!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

      // Verify session advanced to phase1 with an exchange
      const sm2 = new StateManager(dataDir, 'default');
      const updatedSession = sm2.getTutorSession();
      expect(updatedSession).not.toBeNull();
      expect(updatedSession!.phase).toBe('phase1');
      expect(updatedSession!.exchanges.length).toBe(1);
      expect(updatedSession!.exchanges[0].phase).toBe('phase1');
      expect(updatedSession!.exchanges[0].response).toBeNull();
    });

    it('declines tutor offer', async () => {
      const sm = new StateManager(dataDir, 'default');
      const session = createTutorSession('Redis', 1 as any);
      sm.setTutorSession(session);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('no thanks'),
        defaultOpts(dataDir),
      );

      expect(result).toBeNull();

      // Verify tutor session was cleared
      const sm2 = new StateManager(dataDir, 'default');
      expect(sm2.getTutorSession()).toBeNull();
    });

    it('treats unrecognized input as decline when tutor is offered', async () => {
      const sm = new StateManager(dataDir, 'default');
      const session = createTutorSession('Redis', 1 as any);
      sm.setTutorSession(session);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('how do I install webpack?'),
        defaultOpts(dataDir),
      );

      expect(result).toBeNull();

      const sm2 = new StateManager(dataDir, 'default');
      expect(sm2.getTutorSession()).toBeNull();
    });

    it('handles phase1 response', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);

      const session = createTutorSession('Redis', 1 as any);
      session.phase = 'phase1';
      const exchange = createTutorExchange('phase1', '[Entendi Tutor] What do you know about Redis?');
      session.exchanges.push(exchange);
      sm.setTutorSession(session);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('Redis is a key-value store used for caching'),
        defaultOpts(dataDir),
      );

      expect(result).toBeDefined();
      expect(result!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

      // Verify phase advanced to phase2
      const sm2 = new StateManager(dataDir, 'default');
      const updatedSession = sm2.getTutorSession();
      expect(updatedSession).not.toBeNull();
      expect(updatedSession!.phase).toBe('phase2');
      expect(updatedSession!.phase1Score).not.toBeNull();

      // Verify knowledge graph was updated
      const ucs = sm2.getKnowledgeGraph().getUserConceptState('default', 'Redis');
      expect(ucs.assessmentCount).toBe(1);
      expect(ucs.history.length).toBe(1);
      expect(ucs.history[0].eventType).toBe('tutor_phase1');
    });

    it('handles phase2 response (no scoring)', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);

      const session = createTutorSession('Redis', 1 as any);
      session.phase = 'phase2';
      session.phase1Score = 1 as any;
      const ex1 = createTutorExchange('phase1', 'What do you know about Redis?');
      ex1.response = 'It is a cache';
      const ex2 = createTutorExchange('phase2', '[Entendi Tutor] Why is Redis fast?');
      session.exchanges.push(ex1, ex2);
      sm.setTutorSession(session);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('Because it stores data in memory instead of disk'),
        defaultOpts(dataDir),
      );

      expect(result).toBeDefined();
      expect(result!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

      // Verify phase advanced to phase3
      const sm2 = new StateManager(dataDir, 'default');
      const updatedSession = sm2.getTutorSession();
      expect(updatedSession).not.toBeNull();
      expect(updatedSession!.phase).toBe('phase3');

      // Verify NO knowledge graph update (phase2 is not scored)
      const ucs = sm2.getKnowledgeGraph().getUserConceptState('default', 'Redis');
      expect(ucs.assessmentCount).toBe(0);
    });

    it('completes phase4', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);

      const session = createTutorSession('Redis', 1 as any);
      session.phase = 'phase4';
      session.phase1Score = 1 as any;

      const ex1 = createTutorExchange('phase1', 'What do you know about Redis?');
      ex1.response = 'It is a cache';
      const ex2 = createTutorExchange('phase2', 'Why is Redis fast?');
      ex2.response = 'In-memory';
      const ex3 = createTutorExchange('phase3', 'What are the trade-offs?');
      ex3.response = 'Data can be lost on restart';
      const ex4 = createTutorExchange('phase4', '[Entendi Tutor] Explain the full picture of Redis.');
      session.exchanges.push(ex1, ex2, ex3, ex4);
      sm.setTutorSession(session);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('Redis is an in-memory data store that trades durability for speed. It supports persistence through AOF and RDB snapshots.'),
        defaultOpts(dataDir),
      );

      expect(result).toBeDefined();
      expect(result!.hookSpecificOutput?.additionalContext).toContain('complete');

      // Verify session is cleared
      const sm2 = new StateManager(dataDir, 'default');
      expect(sm2.getTutorSession()).toBeNull();

      // Verify knowledge graph has a tutored assessment event
      const ucs = sm2.getKnowledgeGraph().getUserConceptState('default', 'Redis');
      expect(ucs.assessmentCount).toBe(1);
      expect(ucs.history.length).toBe(1);
      expect(ucs.history[0].eventType).toBe('tutor_phase4');
      expect(ucs.history[0].tutored).toBe(true);
    });

    it('detects "teach me about X" pattern', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('teach me about Redis'),
        defaultOpts(dataDir),
      );

      expect(result).toBeDefined();
      expect(result!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

      // Verify a tutor session is created at phase1
      const sm2 = new StateManager(dataDir, 'default');
      const session = sm2.getTutorSession();
      expect(session).not.toBeNull();
      expect(session!.phase).toBe('phase1');
      expect(session!.conceptId).toBe('Redis');
      expect(session!.triggerProbeScore).toBeNull();
      expect(session!.exchanges.length).toBe(1);
    });

    it('detects "explain X to me" pattern', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('explain redis to me'),
        defaultOpts(dataDir),
      );

      expect(result).toBeDefined();

      const sm2 = new StateManager(dataDir, 'default');
      const session = sm2.getTutorSession();
      expect(session).not.toBeNull();
      expect(session!.conceptId).toBe('Redis');
    });

    it('detects "help me understand X" pattern', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('help me understand Redis'),
        defaultOpts(dataDir),
      );

      expect(result).toBeDefined();

      const sm2 = new StateManager(dataDir, 'default');
      const session = sm2.getTutorSession();
      expect(session).not.toBeNull();
      expect(session!.conceptId).toBe('Redis');
    });

    it('does not start proactive tutor if tutorMode is off', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);
      sm.save();

      // Write an org-policy that disables tutor
      const { writeFileSync } = await import('fs');
      writeFileSync(
        join(dataDir, 'org-policy.json'),
        JSON.stringify({ tutorMode: 'off' }),
      );

      const result = await handleUserPromptSubmit(
        makeInput('teach me about Redis'),
        defaultOpts(dataDir),
      );

      // Should not start tutor
      expect(result).toBeNull();
    });

    it('does not start proactive tutor if tutorMode is reactive', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);
      sm.save();

      const { writeFileSync } = await import('fs');
      writeFileSync(
        join(dataDir, 'org-policy.json'),
        JSON.stringify({ tutorMode: 'reactive' }),
      );

      const result = await handleUserPromptSubmit(
        makeInput('teach me about Redis'),
        defaultOpts(dataDir),
      );

      // Reactive mode does not allow proactive starts
      expect(result).toBeNull();
    });

    it('handles tutor timeout', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);

      const session = createTutorSession('Redis', 1 as any);
      session.phase = 'phase2';
      // Set startedAt to >30 minutes ago to trigger timeout
      session.startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
      const ex1 = createTutorExchange('phase1', 'What do you know?');
      ex1.response = 'Something';
      const ex2 = createTutorExchange('phase2', 'Why?');
      session.exchanges.push(ex1, ex2);
      sm.setTutorSession(session);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('late answer'),
        defaultOpts(dataDir),
      );

      expect(result).toBeDefined();
      expect(result!.hookSpecificOutput?.additionalContext).toContain('timed out');

      // Session should be cleared
      const sm2 = new StateManager(dataDir, 'default');
      expect(sm2.getTutorSession()).toBeNull();
    });

    it('active tutor takes priority over pending probe', async () => {
      const sm = new StateManager(dataDir, 'default');
      addRedisConcept(sm);

      // Set up both a pending probe and an active tutor session
      sm.setPendingProbe({
        probe: {
          probeId: 'p1',
          conceptId: 'Redis',
          question: 'Why Redis?',
          depth: 0,
          probeType: 'why',
        },
        triggeredAt: new Date().toISOString(),
        triggerContext: 'npm install redis',
        previousResponses: [],
      });

      const session = createTutorSession('Redis', 1 as any);
      session.phase = 'phase2';
      const ex1 = createTutorExchange('phase1', 'What do you know?');
      ex1.response = 'Something';
      const ex2 = createTutorExchange('phase2', 'Why?');
      session.exchanges.push(ex1, ex2);
      sm.setTutorSession(session);
      sm.save();

      const result = await handleUserPromptSubmit(
        makeInput('Because of speed'),
        defaultOpts(dataDir),
      );

      // Should be handled as tutor response, not probe
      expect(result).toBeDefined();
      expect(result!.hookSpecificOutput?.additionalContext).toContain('Entendi Tutor');

      // Probe should still be pending (tutor handler doesn't clear it)
      const sm2 = new StateManager(dataDir, 'default');
      expect(sm2.getProbeSession().pendingProbe).not.toBeNull();
    });
  });
});

describe('detectTeachMePattern', () => {
  const concepts = [
    { conceptId: 'Redis', aliases: ['redis', 'redis-cli'] },
    { conceptId: 'React', aliases: ['react', 'reactjs'] },
    { conceptId: 'Docker Compose', aliases: ['docker-compose', 'docker compose'] },
  ];

  it('matches "teach me about X"', () => {
    expect(detectTeachMePattern('teach me about Redis', concepts)).toBe('Redis');
  });

  it('matches "explain X to me"', () => {
    expect(detectTeachMePattern('explain React to me', concepts)).toBe('React');
  });

  it('matches "help me understand X"', () => {
    expect(detectTeachMePattern('help me understand Redis', concepts)).toBe('Redis');
  });

  it('matches case-insensitively', () => {
    expect(detectTeachMePattern('teach me about redis', concepts)).toBe('Redis');
  });

  it('matches aliases', () => {
    expect(detectTeachMePattern('teach me about reactjs', concepts)).toBe('React');
  });

  it('returns null for unknown concepts', () => {
    expect(detectTeachMePattern('teach me about Kubernetes', concepts)).toBeNull();
  });

  it('returns null for non-matching prompts', () => {
    expect(detectTeachMePattern('how do I install webpack?', concepts)).toBeNull();
  });

  it('handles trailing punctuation', () => {
    expect(detectTeachMePattern('teach me about Redis?', concepts)).toBe('Redis');
  });
});
