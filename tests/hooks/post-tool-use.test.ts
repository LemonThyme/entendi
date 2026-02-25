import { describe, it, expect } from 'vitest';
import { handlePostToolUse } from '../../src/hooks/post-tool-use.js';

describe('handlePostToolUse', () => {
  it('detects npm install and returns additionalContext', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install redis' },
      tool_response: { stdout: 'added 1 package' },
    };
    const result = await handlePostToolUse(input, { skipLLM: true });
    expect(result).toBeDefined();
    expect(result!.hookSpecificOutput?.additionalContext).toBeTruthy();
  });

  it('ignores non-Bash tools', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/foo.ts' },
    };
    const result = await handlePostToolUse(input, { skipLLM: true });
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
    const result = await handlePostToolUse(input, { skipLLM: true });
    expect(result).toBeNull();
  });

  it('ignores packages not in the concept map', async () => {
    const input = {
      session_id: 'test',
      cwd: '/tmp/test-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install some-totally-unknown-xyz-pkg' },
    };
    const result = await handlePostToolUse(input, { skipLLM: true });
    expect(result).toBeNull();
  });
});
