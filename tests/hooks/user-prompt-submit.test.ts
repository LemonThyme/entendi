import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectLoginPattern, detectTeachMePattern, handleUserPromptSubmit } from '../../src/hooks/user-prompt-submit.js';
import type { PendingAction } from '../../src/schemas/types.js';
import { loadConfig } from '../../src/shared/config.js';

const { TEST_HOME } = vi.hoisted(() => ({
  TEST_HOME: '/tmp/entendi-ups-test',
}));

vi.mock('../../src/shared/config.js', () => ({
  loadConfig: vi.fn(() => ({ apiUrl: 'http://localhost:3456', apiKey: 'test-key' })),
  saveConfig: vi.fn(),
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => TEST_HOME };
});

const mockLoadConfig = vi.mocked(loadConfig);

beforeAll(() => {
  mkdirSync(join(TEST_HOME, '.entendi'), { recursive: true });
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

function makeInput(prompt: string) {
  return {
    session_id: 'test',
    cwd: '/tmp',
    hook_event_name: 'UserPromptSubmit' as const,
    prompt,
  };
}

/**
 * Mock globalThis.fetch to return a pending action from the API.
 * The hook calls GET /api/mcp/pending-action which returns { pending, enforcement }.
 */
function mockPendingAction(action: PendingAction | null, enforcement = 'remind') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ pending: action, enforcement }),
  }));
}

describe('handleUserPromptSubmit (thin observer)', () => {
  beforeEach(() => {
    // Set env vars the hook needs for API calls
    process.env.ENTENDI_API_URL = 'http://localhost:3456';
    process.env.ENTENDI_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ENTENDI_API_URL;
    delete process.env.ENTENDI_API_KEY;
  });

  // --- awaiting_probe_response ---

  it('returns evaluation instructions when awaiting_probe_response is pending', async () => {
    mockPendingAction({
      type: 'awaiting_probe_response',
      conceptId: 'Redis',
      depth: 1,
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit(makeInput('Redis is an in-memory cache'));

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
    mockPendingAction({
      type: 'tutor_offered',
      conceptId: 'Redis',
      triggerScore: 1,
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit(makeInput('yes'));

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
    mockPendingAction({
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase1',
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit(makeInput('Redis is a key-value store'));

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
    mockPendingAction({
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase2',
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit(makeInput('Because it uses memory'));

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('phase2');
    expect(ctx).toContain('misconception');
    expect(ctx).toContain('entendi_advance_tutor');
  });

  it('returns phase3 instructions when tutor_active in phase3', async () => {
    mockPendingAction({
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase3',
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit(makeInput('I see, so it can lose data'));

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('phase3');
    expect(ctx).toContain('misconception');
    expect(ctx).toContain('entendi_advance_tutor');
  });

  it('returns phase4 instructions when tutor_active in phase4', async () => {
    mockPendingAction({
      type: 'tutor_active',
      sessionId: 'sess-1',
      conceptId: 'Redis',
      phase: 'phase4',
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit(makeInput('Redis is an in-memory store with AOF'));

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('phase4');
    expect(ctx).toContain('0-3 rubric');
    expect(ctx).toContain('entendi_advance_tutor');
    expect(ctx).toContain('score, confidence, reasoning');
  });

  // --- No pending action ---

  it('injects observe reminder when no pending action and enforcement is remind', async () => {
    mockPendingAction(null, 'remind');
    const result = await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));
    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('entendi_observe');
    expect(ctx).toContain('MANDATORY');
  });

  it('does NOT inject reminder when enforcement is off', async () => {
    mockPendingAction(null, 'off');
    const result = await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));
    expect(result).toBeNull();
  });

  it('does NOT inject observe reminder when pending action exists', async () => {
    mockPendingAction(
      { type: 'awaiting_probe_response', conceptId: 'oauth', depth: 1, timestamp: new Date().toISOString() },
      'enforce',
    );
    const result = await handleUserPromptSubmit(makeInput('oauth uses tokens'));
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('pending comprehension probe');
    expect(ctx).not.toContain('MANDATORY');
  });

  // --- Teach me pattern ---

  it('returns start_tutor instructions for "teach me about X"', async () => {
    mockPendingAction(null);
    const result = await handleUserPromptSubmit(makeInput('teach me about Redis'));

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Entendi');
    expect(ctx).toContain('Redis');
    expect(ctx).toContain('entendi_start_tutor');
    expect(ctx).toContain('triggerScore null');
  });

  it('returns start_tutor instructions for "explain X to me"', async () => {
    mockPendingAction(null);
    const result = await handleUserPromptSubmit(makeInput('explain Docker to me'));

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Docker');
    expect(ctx).toContain('entendi_start_tutor');
  });

  it('returns start_tutor instructions for "help me understand X"', async () => {
    mockPendingAction(null);
    const result = await handleUserPromptSubmit(makeInput('help me understand async programming'));

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('async programming');
    expect(ctx).toContain('entendi_start_tutor');
  });

  it('calls API once per invocation', async () => {
    mockPendingAction({
      type: 'awaiting_probe_response',
      conceptId: 'Redis',
      depth: 1,
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit(makeInput('Redis is a cache'));
    expect(result).toBeDefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns remind enforcement when API fetch times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')));
    const result = await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));
    // Should fall back to 'remind' (not 'off'), so observe reminder is still injected
    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('entendi_observe');
    expect(ctx).toContain('MANDATORY');
  });

  it('returns remind enforcement when API returns 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));
    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('entendi_observe');
    expect(ctx).toContain('MANDATORY');
  });

  it('passes AbortSignal.timeout to fetch', async () => {
    mockPendingAction(null, 'remind');
    await handleUserPromptSubmit(makeInput('hello'));
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].signal).toBeDefined();
  });

  it('writes userPrompt to enforcement cache alongside enforcement level', async () => {
    mockPendingAction(null, 'enforce');
    await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));

    const cachePath = join(TEST_HOME, '.entendi', 'enforcement-cache.json');
    expect(existsSync(cachePath)).toBe(true);
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
    expect(cached.enforcement).toBe('enforce');
    expect(cached.userPrompt).toBe('fix the OAuth redirect');
  });

  it('returns null gracefully when API is unavailable', async () => {
    // No API key configured — enforcement defaults to 'off' (no API = no enforcement)
    mockLoadConfig.mockReturnValueOnce({ apiUrl: 'http://localhost:3456', apiKey: undefined });

    const result = await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));
    expect(result).toBeNull();
  });

  it('retries dismiss from local marker file before fetching pending action', async () => {
    // Write a pending-dismiss marker file
    const markerPath = join(TEST_HOME, '.entendi', 'pending-dismiss.json');
    writeFileSync(markerPath, JSON.stringify({ conceptId: 'oauth', reason: 'session_ended', ts: Date.now() }));

    // Mock fetch: first call is dismiss retry (success), second is pending-action
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ acknowledged: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: null, enforcement: 'remind' }) });
    vi.stubGlobal('fetch', fetchMock);

    await handleUserPromptSubmit(makeInput('hello world'));

    // Verify dismiss was retried
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const dismissCall = fetchMock.mock.calls[0];
    expect(dismissCall[0]).toContain('/api/mcp/dismiss');

    // Verify marker was deleted
    expect(existsSync(markerPath)).toBe(false);
  });

  it('proceeds normally when no marker file exists', async () => {
    mockPendingAction(null, 'remind');
    // No marker file — should just proceed to fetchPendingAction
    await handleUserPromptSubmit(makeInput('hello world'));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('detectLoginPattern', () => {
  it('matches "entendi login"', () => {
    expect(detectLoginPattern('entendi login')).toBe(true);
  });

  it('matches "entendi log in"', () => {
    expect(detectLoginPattern('entendi log in')).toBe(true);
  });

  it('matches "log in to entendi"', () => {
    expect(detectLoginPattern('log in to entendi')).toBe(true);
  });

  it('matches "login to entendi"', () => {
    expect(detectLoginPattern('login to entendi')).toBe(true);
  });

  it('matches "link my account"', () => {
    expect(detectLoginPattern('link my account')).toBe(true);
  });

  it('matches "link my entendi account"', () => {
    expect(detectLoginPattern('link my entendi account')).toBe(true);
  });

  it('matches "entendi auth"', () => {
    expect(detectLoginPattern('entendi auth')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(detectLoginPattern('Entendi Login')).toBe(true);
  });

  it('returns false for unrelated prompts', () => {
    expect(detectLoginPattern('how do I install webpack?')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(detectLoginPattern('')).toBe(false);
  });
});

describe('handleUserPromptSubmit — login detection', () => {
  beforeEach(() => {
    // No API key — simulates unauthenticated user
    mockLoadConfig.mockReturnValue({ apiUrl: 'http://localhost:3456', apiKey: undefined });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns login instructions when user says "entendi login"', async () => {
    const result = await handleUserPromptSubmit(makeInput('entendi login'));

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Entendi');
    expect(ctx).toContain('entendi_login');
    expect(ctx).toContain('device-code');
  });

  it('login detection takes priority over pending actions', async () => {
    mockLoadConfig.mockReturnValue({ apiUrl: 'http://localhost:3456', apiKey: 'test-key' });
    mockPendingAction({
      type: 'awaiting_probe_response',
      conceptId: 'Redis',
      depth: 1,
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit(makeInput('entendi login'));

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('entendi_login');
    // Should NOT contain probe instructions
    expect(ctx).not.toContain('entendi_record_evaluation');
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
