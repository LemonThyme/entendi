import { describe, expect, it } from 'vitest';
import { masteryLabel, masteryRange, trendDirection } from '../../src/core/mastery-display.js';

describe('masteryRange', () => {
  it('returns clamped range for high uncertainty', () => {
    const range = masteryRange(0, 1.5);
    expect(range.value).toBe(50);
    expect(range.low).toBeGreaterThanOrEqual(0);
    expect(range.high).toBeLessThanOrEqual(100);
    expect(range.low).toBeLessThan(range.value);
    expect(range.high).toBeGreaterThan(range.value);
  });

  it('returns tight range for low uncertainty', () => {
    const range = masteryRange(2, 0.1);
    expect(range.high - range.low).toBeLessThan(10);
  });

  it('clamps to 0-100', () => {
    const range = masteryRange(-5, 2);
    expect(range.low).toBe(0);
  });
});

describe('masteryLabel', () => {
  it('returns range string', () => {
    expect(masteryLabel(0, 1.5)).toMatch(/\d+–\d+%/);
  });
});

describe('trendDirection', () => {
  it('returns up for increasing mastery', () => {
    expect(trendDirection([0.3, 0.5, 0.7])).toBe('up');
  });

  it('returns down for decreasing mastery', () => {
    expect(trendDirection([0.7, 0.5, 0.3])).toBe('down');
  });

  it('returns flat for stable mastery', () => {
    expect(trendDirection([0.5, 0.5, 0.5])).toBe('flat');
  });

  it('returns flat for empty array', () => {
    expect(trendDirection([])).toBe('flat');
  });
});
