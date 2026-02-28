// tests/mcp/response-cache.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResponseCache } from '../../src/mcp/response-cache.js';

describe('ResponseCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('key', () => {
    it('builds cache key from method and path', () => {
      expect(ResponseCache.key('GET', '/api/mcp/status')).toBe('GET:/api/mcp/status');
    });

    it('includes query parameters in the key', () => {
      expect(ResponseCache.key('GET', '/api/mcp/status?conceptId=redis')).toBe(
        'GET:/api/mcp/status?conceptId=redis',
      );
    });
  });

  describe('get/set', () => {
    it('returns undefined for missing keys', () => {
      const cache = new ResponseCache();
      expect(cache.get('missing')).toBeUndefined();
    });

    it('stores and retrieves values', () => {
      const cache = new ResponseCache();
      const data = { mastery: 0.75 };
      cache.set('key1', data);
      expect(cache.get('key1')).toEqual(data);
    });

    it('returns distinct cached objects for different keys', () => {
      const cache = new ResponseCache();
      cache.set('a', { value: 1 });
      cache.set('b', { value: 2 });
      expect(cache.get('a')).toEqual({ value: 1 });
      expect(cache.get('b')).toEqual({ value: 2 });
    });
  });

  describe('TTL expiration', () => {
    it('returns data before TTL expires', () => {
      const cache = new ResponseCache({ ttlMs: 60_000 });
      cache.set('key', { data: true });

      vi.advanceTimersByTime(59_999);
      expect(cache.get('key')).toEqual({ data: true });
    });

    it('returns undefined after TTL expires', () => {
      const cache = new ResponseCache({ ttlMs: 60_000 });
      cache.set('key', { data: true });

      vi.advanceTimersByTime(60_001);
      expect(cache.get('key')).toBeUndefined();
    });

    it('cleans up expired entries on get', () => {
      const cache = new ResponseCache({ ttlMs: 1000 });
      cache.set('key', 'value');
      expect(cache.size).toBe(1);

      vi.advanceTimersByTime(1001);
      cache.get('key'); // triggers cleanup
      expect(cache.size).toBe(0);
    });
  });

  describe('invalidate', () => {
    it('removes a specific entry', () => {
      const cache = new ResponseCache();
      cache.set('a', 1);
      cache.set('b', 2);

      expect(cache.invalidate('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
    });

    it('returns false for non-existent key', () => {
      const cache = new ResponseCache();
      expect(cache.invalidate('nope')).toBe(false);
    });
  });

  describe('invalidateMatching', () => {
    it('removes entries matching a substring', () => {
      const cache = new ResponseCache();
      cache.set('GET:/api/mcp/status', { a: 1 });
      cache.set('GET:/api/mcp/status?conceptId=redis', { a: 2 });
      cache.set('GET:/api/mcp/zpd-frontier', { b: 1 });

      const count = cache.invalidateMatching('/api/mcp/status');
      expect(count).toBe(2);
      expect(cache.get('GET:/api/mcp/status')).toBeUndefined();
      expect(cache.get('GET:/api/mcp/status?conceptId=redis')).toBeUndefined();
      expect(cache.get('GET:/api/mcp/zpd-frontier')).toEqual({ b: 1 });
    });

    it('returns 0 when no entries match', () => {
      const cache = new ResponseCache();
      cache.set('a', 1);
      expect(cache.invalidateMatching('zzz')).toBe(0);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new ResponseCache();
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('reflects current entry count', () => {
      const cache = new ResponseCache();
      expect(cache.size).toBe(0);
      cache.set('a', 1);
      expect(cache.size).toBe(1);
      cache.set('b', 2);
      expect(cache.size).toBe(2);
      cache.invalidate('a');
      expect(cache.size).toBe(1);
    });
  });

  describe('default TTL', () => {
    it('uses 60 second TTL by default', () => {
      const cache = new ResponseCache();
      cache.set('key', 'value');

      vi.advanceTimersByTime(59_999);
      expect(cache.get('key')).toBe('value');

      vi.advanceTimersByTime(2);
      expect(cache.get('key')).toBeUndefined();
    });
  });
});
