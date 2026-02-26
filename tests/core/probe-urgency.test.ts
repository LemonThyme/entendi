import { describe, it, expect } from 'vitest';
import { probeUrgency, type ProbeUrgencyInput } from '../../src/core/probe-urgency.js';
import { retrievability } from '../../src/core/probabilistic-model.js';

describe('probeUrgency', () => {
  const baseInput: ProbeUrgencyInput = {
    mu: 0.0,
    sigma: 1.5,
    stability: 1.0,
    daysSinceAssessed: 0,
    assessmentCount: 0,
    fisherInfo: 0.5,
  };

  it('returns a number between 0 and 1', () => {
    const urgency = probeUrgency(baseInput);
    expect(urgency).toBeGreaterThanOrEqual(0);
    expect(urgency).toBeLessThanOrEqual(1);
  });

  it('high sigma (uncertain) increases urgency vs low sigma (confident)', () => {
    const uncertain = probeUrgency({ ...baseInput, sigma: 1.5 });
    const confident = probeUrgency({ ...baseInput, sigma: 0.2 });
    expect(uncertain).toBeGreaterThan(confident);
  });

  it('low mastery increases urgency vs high mastery', () => {
    const lowMastery = probeUrgency({ ...baseInput, mu: -2.0 });
    const highMastery = probeUrgency({ ...baseInput, mu: 2.0 });
    expect(lowMastery).toBeGreaterThan(highMastery);
  });

  it('never-assessed concept has highest urgency', () => {
    const neverAssessed = probeUrgency({ ...baseInput, assessmentCount: 0, sigma: 1.5 });
    const assessed = probeUrgency({ ...baseInput, assessmentCount: 5, sigma: 0.5 });
    expect(neverAssessed).toBeGreaterThan(assessed);
  });

  it('stale knowledge (low retrievability) increases urgency', () => {
    const recent = probeUrgency({ ...baseInput, daysSinceAssessed: 0, assessmentCount: 3, sigma: 0.5 });
    const stale = probeUrgency({ ...baseInput, daysSinceAssessed: 60, assessmentCount: 3, sigma: 0.5 });
    expect(stale).toBeGreaterThan(recent);
  });

  it('expert with high confidence and recent assessment has low urgency', () => {
    const expert: ProbeUrgencyInput = {
      mu: 3.0,        // high mastery
      sigma: 0.15,     // very confident
      stability: 30.0, // stable knowledge
      daysSinceAssessed: 1,
      assessmentCount: 10,
      fisherInfo: 0.1,
    };
    const urgency = probeUrgency(expert);
    expect(urgency).toBeLessThan(0.2);
  });

  it('lucky guess (high mastery but high sigma) still gets high urgency', () => {
    const luckyGuess: ProbeUrgencyInput = {
      mu: 2.0,         // high mastery point estimate
      sigma: 1.4,      // but very uncertain!
      stability: 1.0,
      daysSinceAssessed: 0,
      assessmentCount: 1,
      fisherInfo: 0.5,
    };
    const confirmedExpert: ProbeUrgencyInput = {
      mu: 2.0,         // same mastery
      sigma: 0.2,      // but very confident
      stability: 20.0,
      daysSinceAssessed: 0,
      assessmentCount: 10,
      fisherInfo: 0.1,
    };
    const luckyUrgency = probeUrgency(luckyGuess);
    const expertUrgency = probeUrgency(confirmedExpert);
    expect(luckyUrgency).toBeGreaterThan(expertUrgency);
  });

  it('struggling user (low mastery, low sigma) has moderate urgency', () => {
    // We're confident they don't know it — urgency is about offering help, not probing more
    const struggling: ProbeUrgencyInput = {
      mu: -2.0,
      sigma: 0.3,
      stability: 1.0,
      daysSinceAssessed: 1,
      assessmentCount: 5,
      fisherInfo: 0.1,
    };
    const urgency = probeUrgency(struggling);
    // Should be moderate — we know they struggle, but we're confident about it
    // Not as high as unknown, but not negligible
    expect(urgency).toBeGreaterThan(0.1);
    expect(urgency).toBeLessThan(0.8);
  });

  it('unknown concept (never touched) has maximum urgency', () => {
    const unknown: ProbeUrgencyInput = {
      mu: 0.0,
      sigma: 1.5,
      stability: 1.0,
      daysSinceAssessed: 999,
      assessmentCount: 0,
      fisherInfo: 0.5,
    };
    const urgency = probeUrgency(unknown);
    expect(urgency).toBeGreaterThan(0.7);
  });
});
