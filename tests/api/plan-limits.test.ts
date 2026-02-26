import { describe, it, expect } from 'vitest';
import { getPlanLimits, isValidPlan } from '../../src/api/lib/plan-limits.js';

describe('getPlanLimits', () => {
  it('returns 25 max concepts for free plan', () => {
    expect(getPlanLimits('free').maxConcepts).toBe(25);
  });

  it('returns 50 max concepts for earned_free plan', () => {
    expect(getPlanLimits('earned_free').maxConcepts).toBe(50);
  });

  it('returns Infinity max concepts for pro plan', () => {
    expect(getPlanLimits('pro').maxConcepts).toBe(Infinity);
  });

  it('returns Infinity max concepts for team plan', () => {
    expect(getPlanLimits('team').maxConcepts).toBe(Infinity);
  });
});

describe('isValidPlan', () => {
  it('returns true for valid plans', () => {
    expect(isValidPlan('free')).toBe(true);
    expect(isValidPlan('earned_free')).toBe(true);
    expect(isValidPlan('pro')).toBe(true);
    expect(isValidPlan('team')).toBe(true);
  });

  it('returns false for invalid plans', () => {
    expect(isValidPlan('enterprise')).toBe(false);
    expect(isValidPlan('')).toBe(false);
    expect(isValidPlan('FREE')).toBe(false);
  });
});
