import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { findLastUserMessage, hasObserveCallInCurrentTurn } from '../../src/hooks/transcript.js';

function makeTempTranscript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'entendi-test-'));
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));
  return path;
}

describe('transcript parsing', () => {
  it('detects entendi_observe tool call in current turn', () => {
    const path = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'fix the OAuth redirect' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } },
    ]);
    expect(hasObserveCallInCurrentTurn(path)).toBe(true);
  });

  it('returns false when no observe call exists', () => {
    const path = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'fix the OAuth redirect' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] } },
    ]);
    expect(hasObserveCallInCurrentTurn(path)).toBe(false);
  });

  it('only checks current turn (after last user message with string content)', () => {
    const path = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'first message' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } },
      { type: 'user', message: { role: 'user', content: 'second message' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done!' }] } },
    ]);
    expect(hasObserveCallInCurrentTurn(path)).toBe(false);
  });

  it('ignores tool_result user entries when finding last user message', () => {
    // Tool results are type: "user" but have array content with tool_result blocks
    const path = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'fix OAuth' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', id: 'toolu_1' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } },
    ]);
    // The tool_result is NOT a real user message, so the last real user message is "fix OAuth"
    // The observe call happens after it, so it should be detected
    expect(hasObserveCallInCurrentTurn(path)).toBe(true);
  });

  it('extracts last user message text (string content)', () => {
    const path = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'first message' } },
      { type: 'user', message: { role: 'user', content: 'fix the OAuth redirect issue' } },
    ]);
    expect(findLastUserMessage(path)).toBe('fix the OAuth redirect issue');
  });

  it('extracts last user message text (array content with text block)', () => {
    const path = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'fix OAuth' }] } },
    ]);
    expect(findLastUserMessage(path)).toBe('fix OAuth');
  });

  it('skips tool_result entries when finding last user message', () => {
    const path = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'fix OAuth' } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'result' }] } },
    ]);
    expect(findLastUserMessage(path)).toBe('fix OAuth');
  });

  it('returns empty string for missing file', () => {
    expect(findLastUserMessage('/nonexistent/file.jsonl')).toBe('');
  });

  it('returns false for missing file in hasObserveCallInCurrentTurn', () => {
    expect(hasObserveCallInCurrentTurn('/nonexistent/file.jsonl')).toBe(false);
  });

  it('ignores non-message types (progress, file-history-snapshot)', () => {
    const path = makeTempTranscript([
      { type: 'user', message: { role: 'user', content: 'fix OAuth' } },
      { type: 'progress', data: { type: 'hook_progress' } },
      { type: 'file-history-snapshot', snapshot: {} },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } },
    ]);
    expect(hasObserveCallInCurrentTurn(path)).toBe(true);
  });

  it('handles large transcripts by reading only tail', () => {
    const lines = [];
    for (let i = 0; i < 500; i++) {
      lines.push({ type: 'user', message: { role: 'user', content: `message ${i}` } });
      lines.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `response ${i}` }] } });
    }
    lines.push({ type: 'user', message: { role: 'user', content: 'final message' } });
    lines.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } });
    const path = makeTempTranscript(lines);
    expect(hasObserveCallInCurrentTurn(path)).toBe(true);
    expect(findLastUserMessage(path)).toBe('final message');
  });
});
