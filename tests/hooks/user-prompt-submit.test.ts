import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleUserPromptSubmit, detectTeachMePattern } from '../../src/hooks/user-prompt-submit.js';
import { writePendingAction } from '../../src/mcp/pending-action.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { PendingAction } from '../../src/schemas/types.js';

function makeInput(prompt: string) {
  return {
    session_id: 'test',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit' as const,
    prompt,
  };
}

describe('handleUserPromptSubmit (thin observer)', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-test-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  const opts = () => ({ dataDir, skipLLM: true, userId: 'default' });

  // --- awaiting_probe_response ---

  it('returns evaluation instructions when awaiting_probe_response is pending', async () => {
    const action: PendingAction = {
      type: 'awaiting_probe_response',
      conceptId: 'Redis',
      depth: 1,
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const result = await handleUserPromptSubmit(makeInput('Redis is an in-memory cache'), opts());

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Entendi');
    expect(ctx).toContain('Redis');
    expect(ctx).toContain('entendi_record_evaluation');
    expect(ctx).toContain('entendi_dismiss');
    expect(ctx).toContain('0-3 rubric');
    expect(ctx).toContain("eventType 'probe'");
  });

  // --- tutor_offered ---

  it('returns accept/decline instructions when tutor_offered is pending', async () => {
    const action: PendingAction = {
      type: 'tutor_offered',
      conceptId: 'Redis',
      triggerScore: 1,
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const result = await handleUserPromptSubmit(makeInput('yes'), opts());

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Entendi');
    expect(ctx).toContain('Redis');
    expect(ctx).toContain('entendi_start_tutor');
    expect(ctx).toContain('entendi_dismiss');
    expect(ctx).toContain('triggerScore 1');
  });

  // --- tutor_active (phase-specific) ---

  it('returns phase1 instructions when tutor_active in phase1', async () => {
    const action: PendingAction = {
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase1',
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const result = await handleUserPromptSubmit(makeInput('Redis is a key-value store'), opts());

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Entendi');
    expect(ctx).toContain('Redis');
    expect(ctx).toContain('phase1');
    expect(ctx).toContain('0-3 rubric');
    expect(ctx).toContain('entendi_advance_tutor');
    expect(ctx).toContain('score, confidence, reasoning');
    expect(ctx).toContain('entendi_dismiss');
  });

  it('returns phase2 instructions when tutor_active in phase2', async () => {
    const action: PendingAction = {
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase2',
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const result = await handleUserPromptSubmit(makeInput('Because it uses memory'), opts());

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('phase2');
    expect(ctx).toContain('misconception');
    expect(ctx).toContain('entendi_advance_tutor');
  });

  it('returns phase3 instructions when tutor_active in phase3', async () => {
    const action: PendingAction = {
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase3',
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const result = await handleUserPromptSubmit(makeInput('I see, so it can lose data'), opts());

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('phase3');
    expect(ctx).toContain('misconception');
    expect(ctx).toContain('entendi_advance_tutor');
  });

  it('returns phase4 instructions when tutor_active in phase4', async () => {
    const action: PendingAction = {
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase4',
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const result = await handleUserPromptSubmit(makeInput('Redis is an in-memory store with AOF'), opts());

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('phase4');
    expect(ctx).toContain('0-3 rubric');
    expect(ctx).toContain('entendi_advance_tutor');
    expect(ctx).toContain('score, confidence, reasoning');
  });

  // --- No pending action ---

  it('returns null when no pending action and normal message', async () => {
    const result = await handleUserPromptSubmit(makeInput('hello world'), opts());
    expect(result).toBeNull();
  });

  // --- Teach me pattern ---

  it('returns start_tutor instructions for "teach me about X"', async () => {
    const result = await handleUserPromptSubmit(makeInput('teach me about Redis'), opts());

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Entendi');
    expect(ctx).toContain('Redis');
    expect(ctx).toContain('entendi_start_tutor');
    expect(ctx).toContain('triggerScore null');
  });

  it('returns start_tutor instructions for "explain X to me"', async () => {
    const result = await handleUserPromptSubmit(makeInput('explain Docker to me'), opts());

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Docker');
    expect(ctx).toContain('entendi_start_tutor');
  });

  it('returns start_tutor instructions for "help me understand X"', async () => {
    const result = await handleUserPromptSubmit(makeInput('help me understand async programming'), opts());

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('async programming');
    expect(ctx).toContain('entendi_start_tutor');
  });

  it('does not write any state files (hooks are read-only)', async () => {
    const { readdirSync } = await import('fs');
    const action: PendingAction = {
      type: 'awaiting_probe_response',
      conceptId: 'Redis',
      depth: 1,
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const filesBefore = readdirSync(dataDir).sort();
    await handleUserPromptSubmit(makeInput('Redis is a cache'), opts());
    const filesAfter = readdirSync(dataDir).sort();

    // The hook should not have created or modified any files
    expect(filesAfter).toEqual(filesBefore);
  });

  it('works identically with or without skipLLM (no LLM calls)', async () => {
    const action: PendingAction = {
      type: 'awaiting_probe_response',
      conceptId: 'Redis',
      depth: 1,
      timestamp: new Date().toISOString(),
    };
    writePendingAction(dataDir, action);

    const withSkip = await handleUserPromptSubmit(makeInput('test'), { dataDir, skipLLM: true, userId: 'default' });
    const withoutSkip = await handleUserPromptSubmit(makeInput('test'), { dataDir, skipLLM: false, userId: 'default' });

    expect(withSkip!.hookSpecificOutput?.additionalContext).toBe(
      withoutSkip!.hookSpecificOutput?.additionalContext,
    );
  });
});

describe('detectTeachMePattern', () => {
  it('matches "teach me about X"', () => {
    expect(detectTeachMePattern('teach me about Redis')).toBe('Redis');
  });

  it('matches "explain X to me"', () => {
    expect(detectTeachMePattern('explain React to me')).toBe('React');
  });

  it('matches "help me understand X"', () => {
    expect(detectTeachMePattern('help me understand Redis')).toBe('Redis');
  });

  it('matches case-insensitively', () => {
    expect(detectTeachMePattern('Teach Me About redis')).toBe('redis');
  });

  it('returns null for non-matching prompts', () => {
    expect(detectTeachMePattern('how do I install webpack?')).toBeNull();
  });

  it('handles trailing punctuation', () => {
    expect(detectTeachMePattern('teach me about Redis?')).toBe('Redis');
  });

  it('matches "teach me X" without "about"', () => {
    expect(detectTeachMePattern('teach me Docker')).toBe('Docker');
  });

  it('returns null for empty string', () => {
    expect(detectTeachMePattern('')).toBeNull();
  });
});
