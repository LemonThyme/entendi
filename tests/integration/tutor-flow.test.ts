import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handlePostToolUse } from '../../src/hooks/post-tool-use.js';
import { handleUserPromptSubmit } from '../../src/hooks/user-prompt-submit.js';
import type { PendingAction } from '../../src/schemas/types.js';

function mockPendingAction(action: PendingAction | null) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: action !== null,
    json: async () => ({ pending: action }),
  }));
}

describe('tutor-flow integration (Phase 1c — thin hooks)', () => {
  beforeEach(() => {
    process.env.ENTENDI_API_URL = 'http://localhost:3456';
    process.env.ENTENDI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ENTENDI_API_URL;
    delete process.env.ENTENDI_API_KEY;
  });

  it('reactive tutor flow: install -> probe instructions -> tutor offered -> phase instructions', async () => {
    // Step 1: PostToolUse detects concepts
    const postToolResult = await handlePostToolUse(
      {
        session_id: 'tutor-flow-test',
        cwd: '/tmp',
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm install redis' },
      },
      { skipLLM: true },
    );

    expect(postToolResult).toBeDefined();
    expect(postToolResult!.hookSpecificOutput?.additionalContext).toContain('entendi_observe');

    // Step 2: MCP server writes awaiting_probe_response — mock API response
    mockPendingAction({
      type: 'awaiting_probe_response',
      conceptId: 'Redis',
      depth: 1,
      timestamp: new Date().toISOString(),
    });

    // Step 3: User responds to probe -> hook returns evaluation instructions
    const probeResponse = await handleUserPromptSubmit(
      { session_id: 'tutor-flow-test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'I dunno, it stores stuff I think?' },
    );

    expect(probeResponse).toBeDefined();
    expect(probeResponse!.hookSpecificOutput?.additionalContext).toContain('entendi_record_evaluation');

    // Step 4: MCP server writes tutor_offered — mock API response
    mockPendingAction({
      type: 'tutor_offered',
      conceptId: 'Redis',
      triggerScore: 1,
      timestamp: new Date().toISOString(),
    });

    // Step 5: User accepts tutor -> hook returns accept/decline instructions
    const acceptResult = await handleUserPromptSubmit(
      { session_id: 'tutor-flow-test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'yes' },
    );

    expect(acceptResult).toBeDefined();
    expect(acceptResult!.hookSpecificOutput?.additionalContext).toContain('entendi_start_tutor');

    // Step 6: MCP server writes tutor_active phase1 — mock API response
    mockPendingAction({
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase1',
      timestamp: new Date().toISOString(),
    });

    // Step 7: User responds to phase1
    const phase1Result = await handleUserPromptSubmit(
      { session_id: 'tutor-flow-test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'Redis is a key-value store used for caching' },
    );

    expect(phase1Result).toBeDefined();
    const p1Ctx = phase1Result!.hookSpecificOutput?.additionalContext!;
    expect(p1Ctx).toContain('phase1');
    expect(p1Ctx).toContain('entendi_advance_tutor');
    expect(p1Ctx).toContain('0-3 rubric');

    // Step 8: MCP server advances to phase2
    mockPendingAction({
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase2',
      timestamp: new Date().toISOString(),
    });

    // Step 9: User responds to phase2
    const phase2Result = await handleUserPromptSubmit(
      { session_id: 'tutor-flow-test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'It uses memory instead of disk for speed' },
    );

    expect(phase2Result).toBeDefined();
    const p2Ctx = phase2Result!.hookSpecificOutput?.additionalContext!;
    expect(p2Ctx).toContain('phase2');
    expect(p2Ctx).toContain('misconception');

    // Steps 10-11: phase4
    mockPendingAction({
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase4',
      timestamp: new Date().toISOString(),
    });

    const phase4Result = await handleUserPromptSubmit(
      { session_id: 'tutor-flow-test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'Redis is an in-memory store that trades durability for speed' },
    );

    expect(phase4Result).toBeDefined();
    const p4Ctx = phase4Result!.hookSpecificOutput?.additionalContext!;
    expect(p4Ctx).toContain('phase4');
    expect(p4Ctx).toContain('0-3 rubric');
    expect(p4Ctx).toContain('entendi_advance_tutor');
  });

  it('proactive tutor flow: "teach me" -> start_tutor instructions', async () => {
    mockPendingAction(null);

    const teachResult = await handleUserPromptSubmit(
      { session_id: 'tutor-flow-test', cwd: '/tmp', hook_event_name: 'UserPromptSubmit', prompt: 'teach me about Redis' },
    );

    expect(teachResult).toBeDefined();
    const ctx = teachResult!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Entendi');
    expect(ctx).toContain('Redis');
    expect(ctx).toContain('entendi_start_tutor');
    expect(ctx).toContain('triggerScore null');
  });
});
