// tests/mcp/api-client-resilience.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntendiApiClient } from '../../src/mcp/api-client.js';

// Suppress file-system logging during tests
vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('EntendiApiClient resilience', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchSpy.mockRestore();
  });

  function createClient(opts?: { failureThreshold?: number; cooldownMs?: number; cacheTtlMs?: number }) {
    return new EntendiApiClient({
      apiUrl: 'http://localhost:3456',
      apiKey: 'test-key',
      retry: { maxRetries: 0, baseDelayMs: 0, timeoutMs: 5000 }, // no retries for fast tests
      circuitBreaker: {
        failureThreshold: opts?.failureThreshold ?? 3,
        cooldownMs: opts?.cooldownMs ?? 30_000,
      },
      cacheTtlMs: opts?.cacheTtlMs ?? 60_000,
    });
  }

  function mockJsonResponse(data: unknown, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  function mockErrorResponse(status: number, body = 'error') {
    return Promise.resolve(new Response(body, { status }));
  }

  // --- Circuit breaker integration ---

  describe('circuit breaker integration', () => {
    it('opens circuit after consecutive server errors and fails fast', async () => {
      const client = createClient({ failureThreshold: 3 });

      // 3 consecutive 500 errors
      fetchSpy.mockImplementation(() => mockErrorResponse(500));

      for (let i = 0; i < 3; i++) {
        await expect(client.getStatus()).rejects.toThrow(/failed \(500\)/);
      }

      expect(client.getCircuitBreaker().getState()).toBe('open');

      // Next call should fail fast without hitting fetch
      fetchSpy.mockClear();
      await expect(client.getStatus()).rejects.toThrow(/Circuit breaker OPEN/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('allows a half-open probe after cooldown', async () => {
      const client = createClient({ failureThreshold: 2, cooldownMs: 10_000 });

      fetchSpy.mockImplementation(() => mockErrorResponse(500));
      await expect(client.getStatus()).rejects.toThrow();
      await expect(client.getStatus()).rejects.toThrow();
      expect(client.getCircuitBreaker().getState()).toBe('open');

      // Advance past cooldown
      vi.advanceTimersByTime(10_000);

      // Now provide a successful response
      fetchSpy.mockImplementation(() => mockJsonResponse({ status: 'ok' }));
      const result = await client.getStatus();
      expect(result).toEqual({ status: 'ok' });
      expect(client.getCircuitBreaker().getState()).toBe('closed');
    });

    it('reopens circuit if half-open probe fails', async () => {
      const client = createClient({ failureThreshold: 2, cooldownMs: 5_000 });

      fetchSpy.mockImplementation(() => mockErrorResponse(502));
      await expect(client.getStatus()).rejects.toThrow();
      await expect(client.getStatus()).rejects.toThrow();

      vi.advanceTimersByTime(5_000);
      expect(client.getCircuitBreaker().getState()).toBe('half-open');

      // Probe fails
      await expect(client.getStatus()).rejects.toThrow();
      expect(client.getCircuitBreaker().getState()).toBe('open');
    });

    it('does not open circuit on 4xx client errors', async () => {
      const client = createClient({ failureThreshold: 2 });

      fetchSpy.mockImplementation(() => mockErrorResponse(404, 'not found'));
      await expect(client.getStatus()).rejects.toThrow(/404/);
      await expect(client.getStatus()).rejects.toThrow(/404/);

      // 4xx errors are not retryable, circuit should stay closed
      expect(client.getCircuitBreaker().getState()).toBe('closed');
    });

    it('resets failure count on success', async () => {
      const client = createClient({ failureThreshold: 3 });

      // 2 failures then a success
      let callCount = 0;
      fetchSpy.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) return mockErrorResponse(500);
        return mockJsonResponse({ ok: true });
      });

      await expect(client.getStatus()).rejects.toThrow();
      await expect(client.getStatus()).rejects.toThrow();
      expect(client.getCircuitBreaker().getConsecutiveFailures()).toBe(2);

      await client.getStatus();
      expect(client.getCircuitBreaker().getConsecutiveFailures()).toBe(0);
    });
  });

  // --- Response cache integration ---

  describe('response cache integration', () => {
    it('caches getStatus responses', async () => {
      const client = createClient();

      fetchSpy.mockImplementation(() => mockJsonResponse({ mastery: 0.8 }));

      const result1 = await client.getStatus('redis');
      const result2 = await client.getStatus('redis');

      expect(result1).toEqual({ mastery: 0.8 });
      expect(result2).toEqual({ mastery: 0.8 });
      expect(fetchSpy).toHaveBeenCalledTimes(1); // second call served from cache
    });

    it('caches getZpdFrontier responses', async () => {
      const client = createClient();

      fetchSpy.mockImplementation(() => mockJsonResponse({ concepts: ['a', 'b'] }));

      const result1 = await client.getZpdFrontier();
      const result2 = await client.getZpdFrontier();

      expect(result1).toEqual({ concepts: ['a', 'b'] });
      expect(result2).toEqual({ concepts: ['a', 'b'] });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('uses different cache keys for different conceptIds', async () => {
      const client = createClient();

      let callCount = 0;
      fetchSpy.mockImplementation(() => {
        callCount++;
        return mockJsonResponse({ concept: callCount === 1 ? 'redis' : 'kafka' });
      });

      const r1 = await client.getStatus('redis');
      const r2 = await client.getStatus('kafka');

      expect(r1).toEqual({ concept: 'redis' });
      expect(r2).toEqual({ concept: 'kafka' });
      expect(fetchSpy).toHaveBeenCalledTimes(2); // different keys, both fetched
    });

    it('invalidates status cache after recordEvaluation', async () => {
      const client = createClient();

      fetchSpy.mockImplementation(() => mockJsonResponse({ mastery: 0.5 }));
      await client.getStatus('redis');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // recordEvaluation should invalidate status cache
      fetchSpy.mockImplementation(() => mockJsonResponse({ updated: true }));
      await client.recordEvaluation({
        conceptId: 'redis',
        score: 2,
        confidence: 0.8,
        reasoning: 'good',
        eventType: 'probe',
      });

      // Next getStatus should re-fetch
      fetchSpy.mockImplementation(() => mockJsonResponse({ mastery: 0.7 }));
      const r2 = await client.getStatus('redis');
      expect(r2).toEqual({ mastery: 0.7 });
    });

    it('invalidates status cache after observe', async () => {
      const client = createClient();

      fetchSpy.mockImplementation(() => mockJsonResponse({ mastery: 0.3 }));
      await client.getStatus();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockImplementation(() => mockJsonResponse({ observed: true }));
      await client.observe({
        concepts: [{ id: 'redis', source: 'llm' }],
        triggerContext: 'test',
      });

      fetchSpy.mockImplementation(() => mockJsonResponse({ mastery: 0.4 }));
      const r = await client.getStatus();
      expect(r).toEqual({ mastery: 0.4 });
    });

    it('invalidates zpd-frontier cache after advanceTutor', async () => {
      const client = createClient();

      fetchSpy.mockImplementation(() => mockJsonResponse({ frontier: ['a'] }));
      await client.getZpdFrontier();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockImplementation(() => mockJsonResponse({ advanced: true }));
      await client.advanceTutor({
        sessionId: 'sess-1',
        userResponse: 'my answer',
      });

      fetchSpy.mockImplementation(() => mockJsonResponse({ frontier: ['a', 'b'] }));
      const r = await client.getZpdFrontier();
      expect(r).toEqual({ frontier: ['a', 'b'] });
    });

    it('cache expires after TTL', async () => {
      const client = createClient({ cacheTtlMs: 5_000 });

      fetchSpy.mockImplementation(() => mockJsonResponse({ v: 1 }));
      await client.getStatus();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5_001);

      fetchSpy.mockImplementation(() => mockJsonResponse({ v: 2 }));
      const r = await client.getStatus();
      expect(r).toEqual({ v: 2 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
