import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handlePostToolUse } from '../../src/hooks/post-tool-use.js';
import { handleUserPromptSubmit } from '../../src/hooks/user-prompt-submit.js';
import { writePendingAction } from '../../src/mcp/pending-action.js';
import { KnowledgeGraph } from '../../src/core/knowledge-graph.js';
import { buildSeedConceptNodes } from '../../src/config/seed-taxonomy.js';
import { grmFisherInformation, grmBayesianUpdate } from '../../src/core/probabilistic-model.js';
import { createDashboardApp } from '../../src/dashboard/server.js';
import { StateManager } from '../../src/core/state-manager.js';
import type { PendingAction } from '../../src/schemas/types.js';

describe('end-to-end flow (Phase 1c — thin hooks + MCP)', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'entendi-e2e-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('PostToolUse detects concepts and instructs Claude to call entendi_observe', async () => {
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

    expect(postToolResult).toBeDefined();
    const ctx = postToolResult!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('entendi_observe');
    expect(ctx).toContain('redis');
  });

  it('UserPromptSubmit reads pending action and returns evaluation instructions', async () => {
    const dataDir = join(projectDir, '.entendi');
    const action: PendingAction = {
      type: 'awaiting_probe_response',
      conceptId: 'Redis',
      depth: 1,
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const submitResult = await handleUserPromptSubmit(
      {
        session_id: 's1',
        cwd: projectDir,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'I need Redis for caching API responses',
      },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    expect(submitResult).toBeDefined();
    expect(submitResult!.hookSpecificOutput?.additionalContext).toContain('entendi_record_evaluation');
    expect(submitResult!.hookSpecificOutput?.additionalContext).toContain('Entendi');
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
    expect(postToolResult!.hookSpecificOutput?.additionalContext).toBeTruthy();
  });

  it('tutor active flow: hook returns phase-specific instructions', async () => {
    const dataDir = join(projectDir, '.entendi');
    const action: PendingAction = {
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase2',
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const result = await handleUserPromptSubmit(
      {
        session_id: 's1',
        cwd: projectDir,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'It uses memory instead of disk',
      },
      { dataDir, skipLLM: true, userId: 'default' },
    );

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('phase2');
    expect(ctx).toContain('entendi_advance_tutor');
    expect(ctx).toContain('misconception');
  });

  it('no probe when concept is routine (hook still detects concepts)', async () => {
    // PostToolUse is now a thin observer; it always returns concepts if found.
    // Probe/skip logic is in the MCP entendi_observe tool.
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

    // Hook always returns concepts if it can map the package
    expect(result).toBeDefined();
    expect(result!.hookSpecificOutput?.additionalContext).toContain('entendi_observe');
  });
});

describe('Phase 1a Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'entendi-p1a-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('PostToolUse detects concepts, UserPromptSubmit reads pending action', async () => {
    const dataDir = join(tmpDir, '.entendi');

    // 1. Package install triggers concept detection
    const installResult = await handlePostToolUse(
      { session_id: 's1', cwd: tmpDir, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm install redis' }, tool_output: 'added redis@4' },
      { skipLLM: true, dataDir, userId: 'student1' },
    );
    expect(installResult).toBeDefined();
    expect(installResult!.hookSpecificOutput?.additionalContext).toContain('entendi_observe');

    // 2. Simulate MCP server having written a pending action (observe tool would do this)
    const action: PendingAction = {
      type: 'awaiting_probe_response',
      conceptId: 'Redis',
      depth: 1,
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    // 3. User responds — hook reads pending action and returns instructions
    const respondResult = await handleUserPromptSubmit(
      { session_id: 's1', cwd: tmpDir, hook_event_name: 'UserPromptSubmit', prompt: 'Redis is an in-memory data store used for caching.' },
      { skipLLM: true, dataDir, userId: 'student1' },
    );
    expect(respondResult).toBeDefined();
    expect(respondResult!.hookSpecificOutput?.additionalContext).toContain('entendi_record_evaluation');

    // 4. Dashboard can still serve existing graph data
    const sm = new StateManager(dataDir, 'student1');
    sm.save(); // ensure files exist
    const app = createDashboardApp(tmpDir);
    const graphRes = await app.request('/api/graph');
    expect(graphRes.status).toBe(200);
  });

  it('GRM update produces valid posteriors across rubric scores', () => {
    for (const score of [0, 1, 2, 3] as const) {
      const result = grmBayesianUpdate(score, 0.0, 1.5);
      expect(result.converged).toBe(true);
      expect(Number.isFinite(result.mu)).toBe(true);
      expect(result.sigma).toBeGreaterThan(0);
      expect(result.sigma).toBeLessThanOrEqual(1.5);
    }
  });

  it('Fisher information is consistent across the ability range', () => {
    for (const theta of [-3, -2, -1, 0, 1, 2, 3]) {
      const fi = grmFisherInformation(theta);
      expect(fi).toBeGreaterThan(0);
      expect(Number.isFinite(fi)).toBe(true);
    }
  });

  it('seed taxonomy integrates with knowledge graph', () => {
    const seedNodes = buildSeedConceptNodes();
    const graph = new KnowledgeGraph({ concepts: seedNodes, userStates: {} });

    expect(graph.getAllConcepts().length).toBeGreaterThan(50);

    const asyncConcept = graph.getConcept('async-programming');
    expect(asyncConcept).toBeDefined();
    expect(asyncConcept?.domain).toBe('programming-languages');

    // New user -> novel
    expect(graph.classifyNovelty('newuser', 'async-programming')).toBe('novel');

    // Security concepts -> critical regardless of mastery
    const secConcept = graph.getAllConcepts().find(c => c.domain === 'security');
    if (secConcept) {
      const state = graph.getUserConceptState('user1', secConcept.conceptId);
      state.mastery.mu = 2.0;
      state.assessmentCount = 5;
      state.lastAssessed = new Date().toISOString();
      state.memory.stability = 30;
      graph.setUserConceptState('user1', secConcept.conceptId, state);
      expect(graph.classifyNovelty('user1', secConcept.conceptId)).toBe('critical');
    }
  });
});
