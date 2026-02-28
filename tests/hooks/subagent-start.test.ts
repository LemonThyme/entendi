import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const HOOK_SCRIPT = join(process.cwd(), 'plugin/hooks/subagent-start');
const SUITE_DIR = join(process.cwd(), '.test-tmp', `subagent-start-${randomBytes(4).toString('hex')}`);

function makeTestHome(name: string): string {
  const dir = join(SUITE_DIR, name);
  mkdirSync(join(dir, '.entendi'), { recursive: true });
  return dir;
}

function runHook(overrides: Record<string, string | undefined> = {}): string {
  const env = { ...process.env, ...overrides };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (env as any)[k];
  }
  return execFileSync('bash', [HOOK_SCRIPT], {
    env: env as Record<string, string>,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

describe('subagent-start hook (bash)', () => {
  beforeAll(() => {
    mkdirSync(SUITE_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(SUITE_DIR)) {
      rmSync(SUITE_DIR, { recursive: true, force: true });
    }
  });

  it('outputs valid JSON with skill content', () => {
    const home = makeTestHome('valid-json');
    const output = runHook({ HOME: home });

    const parsed = JSON.parse(output);
    expect(parsed.suppressOutput).toBe(true);
    expect(parsed.additionalContext).toBeDefined();
    expect(parsed.additionalContext.length).toBeGreaterThan(0);
  });

  it('injects concept-detection skill content', () => {
    const home = makeTestHome('skill-content');
    const output = runHook({ HOME: home });

    const parsed = JSON.parse(output);
    expect(parsed.additionalContext).toContain('entendi');
  });

  it('exits with code 0', () => {
    const home = makeTestHome('exit-code');
    runHook({ HOME: home });
  });

  it('outputs valid JSON structure with suppressOutput', () => {
    const home = makeTestHome('structure');
    const output = runHook({ HOME: home });
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('suppressOutput', true);
    expect(parsed).toHaveProperty('additionalContext');
  });
});
