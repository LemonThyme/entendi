import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const HOOK_SCRIPT = join(process.cwd(), 'plugin/hooks/session-start');

/** Each test suite gets a unique directory to avoid cross-file races */
const SUITE_DIR = join(process.cwd(), '.test-tmp', `session-start-${randomBytes(4).toString('hex')}`);

function makeTestHome(name: string): string {
  const dir = join(SUITE_DIR, name);
  mkdirSync(join(dir, '.entendi'), { recursive: true });
  return dir;
}

function runHook(overrides: Record<string, string | undefined> = {}): string {
  const env = {
    ...process.env,
    ENTENDI_API_URL: undefined,
    ENTENDI_API_KEY: undefined,
    CLAUDE_ENV_FILE: undefined,
    ...overrides,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (env as any)[k];
  }
  return execFileSync('bash', [HOOK_SCRIPT], {
    env: env as Record<string, string>,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

describe('session-start hook (bash)', () => {
  beforeAll(() => {
    mkdirSync(SUITE_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(SUITE_DIR)) {
      rmSync(SUITE_DIR, { recursive: true, force: true });
    }
  });

  it('outputs valid JSON', () => {
    const home = makeTestHome('valid-json');
    const output = runHook({ HOME: home });

    const parsed = JSON.parse(output);
    expect(parsed.suppressOutput).toBe(true);
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toBeDefined();
  });

  it('includes concept-detection skill content', () => {
    const home = makeTestHome('skill-content');
    const output = runHook({ HOME: home });

    const parsed = JSON.parse(output);
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain('entendi');
  });

  it('warns when no API key is configured', () => {
    const home = makeTestHome('no-api-key');
    const output = runHook({ HOME: home });

    const parsed = JSON.parse(output);
    expect(parsed.statusMessage).toContain('No API key');
  });

  it('shows warning when API cannot be reached', () => {
    const home = makeTestHome('unreachable');
    writeFileSync(join(home, '.entendi', 'config.json'), JSON.stringify({
      apiKey: 'test-key-123',
      apiUrl: 'http://127.0.0.1:19999',
    }));

    const output = runHook({ HOME: home });

    const parsed = JSON.parse(output);
    expect(parsed.statusMessage).toMatch(/Could not reach API|health check returned/);
  });

  it('exits with code 0', () => {
    const home = makeTestHome('exit-code');
    runHook({ HOME: home });
  });

  it('writes ENTENDI_API_KEY to CLAUDE_ENV_FILE when API key exists', () => {
    const home = makeTestHome('env-file');
    writeFileSync(join(home, '.entendi', 'config.json'), JSON.stringify({
      apiKey: 'my-secret-key',
      apiUrl: 'http://127.0.0.1:19999',
    }));

    const envFile = join(home, 'claude-env');
    writeFileSync(envFile, '');

    runHook({
      HOME: home,
      CLAUDE_ENV_FILE: envFile,
    });

    const envContent = readFileSync(envFile, 'utf-8');
    expect(envContent).toContain('ENTENDI_API_KEY=my-secret-key');
  });

  it('respects ENTENDI_API_URL env var override', () => {
    const home = makeTestHome('url-override');
    writeFileSync(join(home, '.entendi', 'config.json'), JSON.stringify({
      apiKey: 'test-key',
      apiUrl: 'http://config-url:3456',
    }));

    const output = runHook({
      HOME: home,
      ENTENDI_API_URL: 'http://env-override:19999',
    });

    const parsed = JSON.parse(output);
    expect(parsed.statusMessage).toContain('env-override');
  });

  it('has both flat and nested additionalContext fields', () => {
    const home = makeTestHome('dual-fields');
    const output = runHook({ HOME: home });
    const parsed = JSON.parse(output);

    expect(parsed.additional_context).toBeDefined();
    expect(parsed.hookSpecificOutput.additionalContext).toBeDefined();
    expect(parsed.additional_context).toBe(parsed.hookSpecificOutput.additionalContext);
  });
});
