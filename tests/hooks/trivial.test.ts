import { describe, expect, it } from 'vitest';
import { isTrivialMessage } from '../../src/hooks/trivial.js';

describe('isTrivialMessage', () => {
  it.each([
    'yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank you',
    'do it', 'go ahead', 'sounds good', 'lgtm', 'ship it',
    'commit', 'push', 'deploy', 'Yes!', 'OK.', 'LGTM',
  ])('detects "%s" as trivial', (msg) => {
    expect(isTrivialMessage(msg)).toBe(true);
  });

  it.each([
    'fix the OAuth redirect issue',
    'use redis for caching',
    'why is my component re-rendering?',
    'add a websocket connection',
    'try using Thompson sampling',
    'set up CI with GitHub Actions',
  ])('detects "%s" as non-trivial', (msg) => {
    expect(isTrivialMessage(msg)).toBe(false);
  });

  it('treats messages under 15 chars as trivial', () => {
    expect(isTrivialMessage('hi')).toBe(true);
    expect(isTrivialMessage('do it now')).toBe(true);
  });

  it('treats empty string as trivial', () => {
    expect(isTrivialMessage('')).toBe(true);
  });
});
