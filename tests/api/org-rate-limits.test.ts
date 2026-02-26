import { describe, it, expect, vi } from 'vitest';
import { getOrgRateLimits } from '../../src/api/lib/org-rate-limits.js';

// Mock drizzle query builder
function createMockDb(memberships: Array<{ metadata: string | null }>) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(memberships),
  };
  return {
    select: vi.fn().mockReturnValue(chain),
  } as any;
}

describe('getOrgRateLimits', () => {
  it('returns defaults when user has no org memberships', async () => {
    const db = createMockDb([]);
    const limits = await getOrgRateLimits(db, 'user-1');
    expect(limits).toEqual({
      probeEvalsPerConcept: 1,
      probeEvalWindowHours: 24,
      probeIntervalSeconds: 120,
      maxProbesPerHour: 15,
    });
  });

  it('returns defaults when org has no metadata', async () => {
    const db = createMockDb([{ metadata: null }]);
    const limits = await getOrgRateLimits(db, 'user-1');
    expect(limits).toEqual({
      probeEvalsPerConcept: 1,
      probeEvalWindowHours: 24,
      probeIntervalSeconds: 120,
      maxProbesPerHour: 15,
    });
  });

  it('returns unlimited when rateLimitExempt is true', async () => {
    const db = createMockDb([{ metadata: '{"rateLimitExempt": true}' }]);
    const limits = await getOrgRateLimits(db, 'user-1');
    expect(limits).toEqual({
      probeEvalsPerConcept: 0,
      probeEvalWindowHours: 0,
      probeIntervalSeconds: 0,
      maxProbesPerHour: 0,
    });
  });

  it('applies custom rateLimits from org metadata', async () => {
    const db = createMockDb([{
      metadata: JSON.stringify({
        rateLimits: {
          probeEvalsPerConcept: 5,
          probeEvalWindowHours: 1,
          probeIntervalSeconds: 30,
          maxProbesPerHour: 50,
        },
      }),
    }]);
    const limits = await getOrgRateLimits(db, 'user-1');
    expect(limits).toEqual({
      probeEvalsPerConcept: 5,
      probeEvalWindowHours: 1,
      probeIntervalSeconds: 30,
      maxProbesPerHour: 50,
    });
  });

  it('picks most permissive limits across multiple orgs', async () => {
    const db = createMockDb([
      { metadata: JSON.stringify({ rateLimits: { probeEvalsPerConcept: 3, probeIntervalSeconds: 60 } }) },
      { metadata: JSON.stringify({ rateLimits: { probeEvalsPerConcept: 10, probeIntervalSeconds: 30 } }) },
    ]);
    const limits = await getOrgRateLimits(db, 'user-1');
    // probeEvalsPerConcept: max(3, 10) = 10 (more generous)
    // probeIntervalSeconds: min(60, 30) = 30 (shorter = more generous)
    expect(limits.probeEvalsPerConcept).toBe(10);
    expect(limits.probeIntervalSeconds).toBe(30);
  });

  it('unlimited (0) wins over any numeric value', async () => {
    const db = createMockDb([
      { metadata: JSON.stringify({ rateLimits: { probeEvalsPerConcept: 5 } }) },
      { metadata: JSON.stringify({ rateLimits: { probeEvalsPerConcept: 0 } }) },
    ]);
    const limits = await getOrgRateLimits(db, 'user-1');
    expect(limits.probeEvalsPerConcept).toBe(0);
  });

  it('ignores malformed metadata', async () => {
    const db = createMockDb([{ metadata: 'not json' }]);
    const limits = await getOrgRateLimits(db, 'user-1');
    expect(limits).toEqual({
      probeEvalsPerConcept: 1,
      probeEvalWindowHours: 24,
      probeIntervalSeconds: 120,
      maxProbesPerHour: 15,
    });
  });

  it('rateLimitExempt in any org makes user exempt', async () => {
    const db = createMockDb([
      { metadata: JSON.stringify({ rateLimits: { probeEvalsPerConcept: 5 } }) },
      { metadata: JSON.stringify({ rateLimitExempt: true }) },
    ]);
    const limits = await getOrgRateLimits(db, 'user-1');
    expect(limits.probeEvalsPerConcept).toBe(0);
    expect(limits.probeIntervalSeconds).toBe(0);
  });
});
