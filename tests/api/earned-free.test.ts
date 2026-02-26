import { describe, it, expect } from 'vitest';
import {
  shouldGrantEarnedFree,
  getEarnedFreeExpiry,
  getMasteryThreshold,
  getMinConcepts,
} from '../../src/api/lib/earned-free.js';

describe('shouldGrantEarnedFree', () => {
  it('grants when 80%+ concepts are mastered with >= 10 concepts', () => {
    expect(shouldGrantEarnedFree({ totalConcepts: 10, masteredConcepts: 8 })).toBe(true);
    expect(shouldGrantEarnedFree({ totalConcepts: 10, masteredConcepts: 9 })).toBe(true);
    expect(shouldGrantEarnedFree({ totalConcepts: 10, masteredConcepts: 10 })).toBe(true);
    expect(shouldGrantEarnedFree({ totalConcepts: 20, masteredConcepts: 16 })).toBe(true);
  });

  it('denies when below 80% threshold', () => {
    expect(shouldGrantEarnedFree({ totalConcepts: 10, masteredConcepts: 7 })).toBe(false);
    expect(shouldGrantEarnedFree({ totalConcepts: 20, masteredConcepts: 15 })).toBe(false);
    expect(shouldGrantEarnedFree({ totalConcepts: 10, masteredConcepts: 0 })).toBe(false);
  });

  it('denies when fewer than 10 concepts even with 100% mastery', () => {
    expect(shouldGrantEarnedFree({ totalConcepts: 9, masteredConcepts: 9 })).toBe(false);
    expect(shouldGrantEarnedFree({ totalConcepts: 5, masteredConcepts: 5 })).toBe(false);
    expect(shouldGrantEarnedFree({ totalConcepts: 1, masteredConcepts: 1 })).toBe(false);
    expect(shouldGrantEarnedFree({ totalConcepts: 0, masteredConcepts: 0 })).toBe(false);
  });

  it('boundary: exactly 80% with exactly 10 concepts qualifies', () => {
    expect(shouldGrantEarnedFree({ totalConcepts: 10, masteredConcepts: 8 })).toBe(true);
  });

  it('boundary: 79% with 10 concepts does not qualify', () => {
    // 7.9/10 rounds to 7 mastered — below 80%
    expect(shouldGrantEarnedFree({ totalConcepts: 10, masteredConcepts: 7 })).toBe(false);
  });
});

describe('getEarnedFreeExpiry', () => {
  it('returns date 14 days from given date', () => {
    const from = new Date('2026-02-26T00:00:00Z');
    const expiry = getEarnedFreeExpiry(from);
    expect(expiry.toISOString()).toBe('2026-03-12T00:00:00.000Z');
  });

  it('returns date 14 days from now when no argument', () => {
    const before = new Date();
    const expiry = getEarnedFreeExpiry();
    const after = new Date();

    const expectedMin = new Date(before);
    expectedMin.setDate(expectedMin.getDate() + 14);
    const expectedMax = new Date(after);
    expectedMax.setDate(expectedMax.getDate() + 14);

    expect(expiry.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
    expect(expiry.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
  });
});

describe('constants', () => {
  it('mastery threshold is 0.8', () => {
    expect(getMasteryThreshold()).toBe(0.8);
  });

  it('minimum concepts is 10', () => {
    expect(getMinConcepts()).toBe(10);
  });
});
