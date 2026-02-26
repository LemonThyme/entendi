import { describe, it, expect } from 'vitest';
import { propagatePrerequisiteBoost, type PropagationTarget } from '../../src/core/prerequisite-propagation.js';

describe('propagatePrerequisiteBoost', () => {
  it('returns empty array when mastery decreased (no forward propagation of failure)', () => {
    const targets: PropagationTarget[] = [{ conceptId: 'child', mu: 0.0, sigma: 1.5 }];
    const result = propagatePrerequisiteBoost({
      muBefore: 1.0,
      muAfter: 0.5, // decreased
      targets,
    });
    expect(result).toEqual([]);
  });

  it('returns empty array when no targets', () => {
    const result = propagatePrerequisiteBoost({
      muBefore: 0.0,
      muAfter: 1.0,
      targets: [],
    });
    expect(result).toEqual([]);
  });

  it('boosts dependent concepts when mastery improves', () => {
    const targets: PropagationTarget[] = [
      { conceptId: 'child-a', mu: 0.0, sigma: 1.5 },
      { conceptId: 'child-b', mu: -1.0, sigma: 1.0 },
    ];
    const result = propagatePrerequisiteBoost({
      muBefore: 0.0,
      muAfter: 1.5,
      targets,
    });
    expect(result).toHaveLength(2);
    // Each child should have mu increased
    expect(result[0].conceptId).toBe('child-a');
    expect(result[0].newMu).toBeGreaterThan(0.0);
    expect(result[1].conceptId).toBe('child-b');
    expect(result[1].newMu).toBeGreaterThan(-1.0);
  });

  it('boost is proportional to mastery gain', () => {
    const targets: PropagationTarget[] = [{ conceptId: 'child', mu: 0.0, sigma: 1.5 }];
    const smallGain = propagatePrerequisiteBoost({
      muBefore: 0.0,
      muAfter: 0.5,
      targets,
    });
    const largeGain = propagatePrerequisiteBoost({
      muBefore: 0.0,
      muAfter: 2.0,
      targets,
    });
    expect(largeGain[0].newMu).toBeGreaterThan(smallGain[0].newMu);
  });

  it('boost is attenuated (much smaller than the original gain)', () => {
    const targets: PropagationTarget[] = [{ conceptId: 'child', mu: 0.0, sigma: 1.5 }];
    const gain = 2.0;
    const result = propagatePrerequisiteBoost({
      muBefore: 0.0,
      muAfter: gain,
      targets,
    });
    const boost = result[0].newMu - 0.0;
    // Boost should be a fraction of the gain (design doc says 0.3 / depth)
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThan(gain * 0.5); // significantly attenuated
  });

  it('does not boost concepts that are already highly mastered', () => {
    const targets: PropagationTarget[] = [
      { conceptId: 'already-mastered', mu: 3.0, sigma: 0.2 },
    ];
    const result = propagatePrerequisiteBoost({
      muBefore: 0.0,
      muAfter: 1.5,
      targets,
    });
    // Should still return a result but the boost should be negligible
    // because the child is already well above the prerequisite
    expect(result[0].newMu - 3.0).toBeLessThan(0.5);
  });

  it('returns unchanged mu when gain is zero', () => {
    const targets: PropagationTarget[] = [{ conceptId: 'child', mu: 0.5, sigma: 1.0 }];
    const result = propagatePrerequisiteBoost({
      muBefore: 1.0,
      muAfter: 1.0, // no change
      targets,
    });
    expect(result).toEqual([]);
  });
});
