// tests/mcp/circuit-breaker.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker } from '../../src/mcp/api-client.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in closed state', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('closed');
    expect(cb.allowRequest()).toBe(true);
  });

  it('stays closed after fewer failures than threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) {
      cb.recordFailure();
    }
    expect(cb.getState()).toBe('closed');
    expect(cb.allowRequest()).toBe(true);
    expect(cb.getConsecutiveFailures()).toBe(4);
  });

  it('opens after reaching the failure threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 5; i++) {
      cb.recordFailure();
    }
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });

  it('rejects requests when open', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });

  it('transitions to half-open after cooldown', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 30_000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    // Advance time past cooldown
    vi.advanceTimersByTime(30_000);
    expect(cb.getState()).toBe('half-open');
    expect(cb.allowRequest()).toBe(true);
  });

  it('stays open before cooldown expires', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 30_000 });
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(29_999);
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });

  it('closes on success from half-open', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 30_000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(30_000);
    expect(cb.getState()).toBe('half-open');

    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.getConsecutiveFailures()).toBe(0);
    expect(cb.allowRequest()).toBe(true);
  });

  it('reopens on failure from half-open', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 30_000 });
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(30_000);
    expect(cb.getState()).toBe('half-open');

    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });

  it('resets consecutive failures on success from closed', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getConsecutiveFailures()).toBe(3);

    cb.recordSuccess();
    expect(cb.getConsecutiveFailures()).toBe(0);
    expect(cb.getState()).toBe('closed');
  });

  it('uses default failureThreshold of 5', () => {
    const cb = new CircuitBreaker();
    expect(cb.failureThreshold).toBe(5);
  });

  it('uses default cooldownMs of 30000', () => {
    const cb = new CircuitBreaker();
    expect(cb.cooldownMs).toBe(30_000);
  });

  it('can reopen and recover multiple times', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 10_000 });

    // First trip
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(10_000);
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');

    // Second trip
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(10_000);
    expect(cb.getState()).toBe('half-open');
    cb.recordFailure(); // probe fails
    expect(cb.getState()).toBe('open');

    // Third recovery
    vi.advanceTimersByTime(10_000);
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.getConsecutiveFailures()).toBe(0);
  });
});
