import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HOOK_SCRIPT = join(process.cwd(), 'plugin/hooks/session-start');

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

  it('exits with code 0', () => {
    const home = makeTestHome('exit-code');
    runHook({ HOME: home });
  });

  it('has both flat and nested additionalContext fields', () => {
    const home = makeTestHome('dual-fields');
    const output = runHook({ HOME: home });
    const parsed = JSON.parse(output);

    expect(parsed.additional_context).toBeDefined();
    expect(parsed.hookSpecificOutput.additionalContext).toBeDefined();
    expect(parsed.additional_context).toBe(parsed.hookSpecificOutput.additionalContext);
  });

  it('always includes skill content (no init logic)', () => {
    const home = makeTestHome('no-init');
    const output = runHook({ HOME: home });
    const parsed = JSON.parse(output);

    // session-start now only injects the skill, no warnings
    expect(parsed.statusMessage).toBe('Entendi connected');
  });
});
