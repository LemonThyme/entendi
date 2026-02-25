import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleUserPromptSubmit } from '../../src/hooks/user-prompt-submit.js';
import { StateManager } from '../../src/core/state-manager.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
    sm.getKnowledgeGraph().addConcept({
      conceptId: 'Redis',
      aliases: [],
      domain: 'databases',
      specificity: 'topic',
      parentConcept: null,
      itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
      relationships: [],
      lifecycle: 'validated',
    });
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
});
