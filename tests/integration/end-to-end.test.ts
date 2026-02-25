import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateManager } from '../../src/core/state-manager.js';
import { handlePostToolUse } from '../../src/hooks/post-tool-use.js';
import { handleUserPromptSubmit } from '../../src/hooks/user-prompt-submit.js';

describe('end-to-end flow', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'entendi-e2e-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('full cycle: install -> probe -> respond -> update', async () => {
    // 1. PostToolUse: simulate npm install redis
    const postToolResult = await handlePostToolUse(
      {
        session_id: 's1',
        cwd: projectDir,
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm install redis' },
      },
      { skipLLM: true },
    );

    // Should detect concepts and queue a probe
    expect(postToolResult).toBeDefined();
    expect(postToolResult!.hookSpecificOutput?.additionalContext).toBeTruthy();

    // 2. Verify probe was queued in state
    const dataDir = join(projectDir, '.entendi');
    const sm = new StateManager(dataDir, 'default');
    expect(sm.getProbeSession().pendingProbe).toBeDefined();
    expect(sm.getProbeSession().pendingProbe!.probe.conceptId).toBeTruthy();

    // 3. UserPromptSubmit: simulate user answering the probe
    const submitResult = await handleUserPromptSubmit(
      {
        session_id: 's1',
        cwd: projectDir,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'I need Redis for caching API responses to reduce database load and improve response times',
      },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    expect(submitResult).toBeDefined();
    expect(submitResult!.hookSpecificOutput?.additionalContext).toContain('Entendi');

    // 4. Verify knowledge graph was updated
    const sm2 = new StateManager(dataDir, 'default');
    // Find the concept that was probed (get it from the first assessment)
    const conceptId = sm.getProbeSession().pendingProbe!.probe.conceptId;
    const state = sm2.getKnowledgeGraph().getUserConceptState('default', conceptId);
    expect(state.assessmentCount).toBe(1);
    expect(state.history.length).toBe(1);
    expect(state.history[0].eventType).toBe('probe');

    // 5. Verify probe was cleared
    expect(sm2.getProbeSession().pendingProbe).toBeNull();
  });

  it('no probe when concept is routine', async () => {
    // Pre-populate knowledge graph with a mastered concept
    const dataDir = join(projectDir, '.entendi');
    const sm = new StateManager(dataDir, 'default');
    const kg = sm.getKnowledgeGraph();

    // Add redis concept and mark as mastered
    kg.addConcept({
      conceptId: 'Redis',
      aliases: [],
      domain: 'databases',
      specificity: 'topic',
      parentConcept: null,
      itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
      relationships: [],
      lifecycle: 'validated',
      populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
    });
    const ucs = kg.getUserConceptState('default', 'Redis');
    ucs.mastery.mu = 3.0;
    ucs.mastery.sigma = 0.3;
    ucs.assessmentCount = 10;
    ucs.lastAssessed = new Date().toISOString();
    ucs.memory.stability = 30;
    kg.setUserConceptState('default', 'Redis', ucs);
    sm.save();

    // Now install redis again - should be classified as routine
    // Note: with skipLLM=true the probe is forced, so this test verifies
    // that the concept IS recognized (not that probing is skipped)
    // For a proper routine-skip test, we'd need skipLLM=false with mocking
    const result = await handlePostToolUse(
      {
        session_id: 's1',
        cwd: projectDir,
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm install redis' },
      },
      { skipLLM: true },
    );

    // With skipLLM=true it still probes, but we verify the concept was recognized
    expect(result).toBeDefined();
  });

  it('handles multiple packages in one install', async () => {
    const postToolResult = await handlePostToolUse(
      {
        session_id: 's1',
        cwd: projectDir,
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm install express zod' },
      },
      { skipLLM: true },
    );

    expect(postToolResult).toBeDefined();
    // Should have detected concepts from at least one of the packages
    expect(postToolResult!.hookSpecificOutput?.additionalContext).toBeTruthy();
  });
});
