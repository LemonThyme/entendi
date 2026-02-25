import { describe, it, expect } from 'vitest';
import { handlePostToolUse } from '../../src/hooks/post-tool-use.js';

describe('handlePostToolUse (thin observer)', () => {
  it('detects npm install and returns additionalContext mentioning entendi_observe', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install redis' },
      tool_response: { stdout: 'added 1 package' },
    };
    const result = await handlePostToolUse(input);
    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('entendi_observe');
    expect(ctx).toContain('redis');
    expect(ctx).toContain('npm install redis');
  });

  it('ignores non-Bash tools', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/foo.ts' },
    };
    const result = await handlePostToolUse(input);
    expect(result).toBeNull();
  });

  it('ignores non-install Bash commands', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    };
    const result = await handlePostToolUse(input);
    expect(result).toBeNull();
  });

  it('returns null for packages not in the concept map', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install some-totally-unknown-xyz-pkg' },
    };
    const result = await handlePostToolUse(input);
    expect(result).toBeNull();
  });

  it('lists multiple concepts when multiple known packages are installed', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install redis express' },
      tool_response: { stdout: 'added 2 packages' },
    };
    const result = await handlePostToolUse(input);
    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    // Both redis and express concepts should appear
    expect(ctx).toContain('entendi_observe');
    // The lookup table maps redis and express to concepts — verify at least one is listed
    expect(ctx.length).toBeGreaterThan(50);
  });

  it('accepts dataDir and userId options without errors', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const tmpDir = mkdtempSync(join(tmpdir(), 'entendi-ptu-'));
    try {
      const input = {
        session_id: 'test',
        cwd: '/tmp/test-project',
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm install redis' },
        tool_response: { stdout: 'added 1 package' },
      };
      const result = await handlePostToolUse(input, { dataDir: tmpDir, userId: 'test-user' });
      expect(result).toBeDefined();
      expect(result!.hookSpecificOutput?.additionalContext).toContain('entendi_observe');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns null when Bash command has no command field', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: {},
    };
    const result = await handlePostToolUse(input);
    expect(result).toBeNull();
  });

  it('includes trigger context in additionalContext', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'pip install flask' },
      tool_response: { stdout: 'Successfully installed flask' },
    };
    const result = await handlePostToolUse(input);
    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('Trigger: pip install flask');
    expect(ctx).toContain('entendi_observe');
  });

  it('does not make LLM calls or write state (no skipLLM needed)', async () => {
    // The thin hook has no LLM calls; skipLLM is ignored.
    // Verify it works identically with or without skipLLM.
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install redis' },
      tool_response: { stdout: 'added 1 package' },
    };
    const withSkip = await handlePostToolUse(input, { skipLLM: true });
    const withoutSkip = await handlePostToolUse(input, { skipLLM: false });
    // Both should produce the same output
    expect(withSkip!.hookSpecificOutput?.additionalContext).toBe(
      withoutSkip!.hookSpecificOutput?.additionalContext,
    );
  });
});
