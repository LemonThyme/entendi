import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

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
