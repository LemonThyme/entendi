import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleStop } from '../../src/hooks/stop.js';

const HOOK_SCRIPT = join(process.cwd(), 'plugin/hooks/stop');
const SUITE_DIR = join(process.cwd(), '.test-tmp', `stop-${randomBytes(4).toString('hex')}`);

function makeTestHome(name: string): string {
  const dir = join(SUITE_DIR, name);
  mkdirSync(join(dir, '.entendi'), { recursive: true });
  return dir;
}

function runHook(overrides: Record<string, string | undefined>, input?: string): string {
  const env = {
    ...process.env,
    ENTENDI_API_URL: undefined,
    ENTENDI_API_KEY: undefined,
    ...overrides,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (env as any)[k];
  }
  return execFileSync('bash', [HOOK_SCRIPT], {
    env: env as Record<string, string>,
    encoding: 'utf-8',
    timeout: 15000,
    input: input ?? '',
  });
}

describe('stop hook (bash)', () => {
  beforeAll(() => {
    mkdirSync(SUITE_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(SUITE_DIR)) {
      rmSync(SUITE_DIR, { recursive: true, force: true });
    }
  });

  it('exits with code 0 on valid JSON input', () => {
    const home = makeTestHome('valid-json');
    const input = JSON.stringify({ session_id: 'test-session', hook_event_name: 'Stop' });
    runHook({ HOME: home }, input);
  });

  it('exits with code 0 on empty stdin', () => {
    const home = makeTestHome('empty-stdin');
    runHook({ HOME: home }, '');
  });

  it('never blocks session exit (always exits 0 on invalid input)', () => {
    const home = makeTestHome('invalid-input');
    runHook({ HOME: home }, 'not json');
  });

  it('writes to debug log on valid input', () => {
    const home = makeTestHome('debug-log');
    const input = JSON.stringify({ session_id: 'test-session', hook_event_name: 'Stop' });
    runHook({ HOME: home }, input);

    const logFile = join(home, '.entendi', 'debug.log');
    if (existsSync(logFile)) {
      const logContent = readFileSync(logFile, 'utf-8');
      expect(logContent).toContain('hook:stop');
    }
  });

  it('writes to debug log even on empty stdin', () => {
    const home = makeTestHome('debug-empty');
    runHook({ HOME: home }, '');

    const logFile = join(home, '.entendi', 'debug.log');
    if (existsSync(logFile)) {
      const logContent = readFileSync(logFile, 'utf-8');
      expect(logContent).toContain('hook:stop');
    }
  });
});

// --- handleStop unit tests ---

function makeTempTranscript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'entendi-stop-'));
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));
  return path;
}

function writeEnforcementCache(homeDir: string, level: string) {
  writeFileSync(
    join(homeDir, '.entendi', 'enforcement-cache.json'),
    JSON.stringify({ enforcement: level, ts: Date.now() }),
  );
}

describe('handleStop observe enforcement', () => {
  const ENFORCE_SUITE_DIR = join(process.cwd(), '.test-tmp', `stop-enforce-${randomBytes(4).toString('hex')}`);

  function makeEnforceTestHome(name: string): string {
    const dir = join(ENFORCE_SUITE_DIR, name);
    mkdirSync(join(dir, '.entendi'), { recursive: true });
    return dir;
  }

  beforeAll(() => {
    mkdirSync(ENFORCE_SUITE_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(ENFORCE_SUITE_DIR)) {
      rmSync(ENFORCE_SUITE_DIR, { recursive: true, force: true });
    }
  });

  it('allows stop immediately when stop_hook_active is true', async () => {
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      stop_hook_active: true,
      transcript_path: '/nonexistent',
    });
    expect(result).toBeNull();
  });

  it('allows stop when enforcement is off', async () => {
    const home = makeEnforceTestHome('enforce-off');
    writeEnforcementCache(home, 'off');
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: '/nonexistent',
    }, home);
    expect(result).toBeNull();
  });

  it('allows stop when observe was called in current turn', async () => {
    const home = makeEnforceTestHome('observe-called');
    writeEnforcementCache(home, 'enforce');
    const transcript = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'fix OAuth' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } },
    ]);
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: transcript,
    }, home);
    expect(result).toBeNull();
  });

  it('blocks stop when observe was not called and enforcement is enforce', async () => {
    const home = makeEnforceTestHome('observe-missed-enforce');
    writeEnforcementCache(home, 'enforce');
    const transcript = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'fix the OAuth redirect issue with Better Auth' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] } },
    ]);
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: transcript,
    }, home);
    expect(result).toBeDefined();
    expect(result!.decision).toBe('block');
    expect(result!.reason).toContain('entendi_observe');
  });

  it('allows stop (with log) when observe was not called and enforcement is remind', async () => {
    const home = makeEnforceTestHome('observe-missed-remind');
    writeEnforcementCache(home, 'remind');
    const transcript = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'fix the OAuth redirect issue with Better Auth' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] } },
    ]);
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: transcript,
    }, home);
    expect(result).toBeNull();
  });

  it('allows stop when message is trivial', async () => {
    const home = makeEnforceTestHome('trivial-msg');
    writeEnforcementCache(home, 'enforce');
    const transcript = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'yes' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'OK' }] } },
    ]);
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: transcript,
    }, home);
    expect(result).toBeNull();
  });

  it('allows stop gracefully when transcript is missing', async () => {
    const home = makeEnforceTestHome('missing-transcript');
    writeEnforcementCache(home, 'enforce');
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: '/nonexistent/file.jsonl',
    }, home);
    expect(result).toBeNull();
  });

  it('uses userPrompt from cache for trivial detection instead of transcript', async () => {
    const home = makeEnforceTestHome('cache-prompt');
    // Cache has a non-trivial userPrompt
    writeFileSync(
      join(home, '.entendi', 'enforcement-cache.json'),
      JSON.stringify({ enforcement: 'enforce', ts: Date.now(), userPrompt: 'explain how OAuth works with PKCE' }),
    );
    // Transcript has a trivial message (e.g., a short AskUserQuestion selection)
    const tp = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'ok' } },
      { type: 'assistant', message: { role: 'assistant', content: 'OK choosing fail-open.' } },
    ]);
    const result = await handleStop({ session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop', transcript_path: tp }, home);
    // Without the cache fix, 'ok' would be trivial → allow stop
    // With the cache fix, the real userPrompt 'explain...' is non-trivial → block
    expect(result).not.toBeNull();
    expect(result!.decision).toBe('block');
  });

  it('falls back to transcript when cache has no userPrompt', async () => {
    const home = makeEnforceTestHome('no-cache-prompt');
    writeEnforcementCache(home, 'enforce');
    // No userPrompt in cache — old format
    const tp = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'yes' } },
      { type: 'assistant', message: { role: 'assistant', content: 'done' } },
    ]);
    const result = await handleStop({ session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop', transcript_path: tp }, home);
    // 'yes' is trivial — should allow stop
    expect(result).toBeNull();
  });

  it('defaults to remind when no enforcement cache exists', async () => {
    const home = makeEnforceTestHome('no-cache');
    // No cache file written — should default to 'remind' (not block)
    const transcript = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'fix the OAuth redirect issue with Better Auth' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] } },
    ]);
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: transcript,
    }, home);
    expect(result).toBeNull(); // remind mode doesn't block
  });
});
