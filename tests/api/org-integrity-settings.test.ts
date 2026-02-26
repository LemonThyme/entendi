import { describe, it, expect, vi } from 'vitest';
import { getOrgIntegritySettings } from '../../src/api/lib/org-integrity-settings.js';

// Mock drizzle query builder (same pattern as org-rate-limits.test.ts)
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

describe('getOrgIntegritySettings', () => {
  it('returns defaults when user has no org memberships', async () => {
    const db = createMockDb([]);
    const settings = await getOrgIntegritySettings(db, 'user-1');
    expect(settings).toEqual({
      charsPerSecondThreshold: 15,
      formattingScoreThreshold: 3,
      wordCountThreshold: 150,
      styleDriftWordCountRatio: 3,
      styleDriftCharsPerSecRatio: 2.5,
      styleDriftFormattingDiff: 3,
      emaAlpha: 0.3,
      dampeningThreshold: 0.5,
    });
  });

  it('returns defaults when org has no metadata', async () => {
    const db = createMockDb([{ metadata: null }]);
    const settings = await getOrgIntegritySettings(db, 'user-1');
    expect(settings).toEqual({
      charsPerSecondThreshold: 15,
      formattingScoreThreshold: 3,
      wordCountThreshold: 150,
      styleDriftWordCountRatio: 3,
      styleDriftCharsPerSecRatio: 2.5,
      styleDriftFormattingDiff: 3,
      emaAlpha: 0.3,
      dampeningThreshold: 0.5,
    });
  });

  it('applies custom integritySettings from org metadata', async () => {
    const db = createMockDb([{
      metadata: JSON.stringify({
        integritySettings: {
          charsPerSecondThreshold: 20,
          formattingScoreThreshold: 5,
          wordCountThreshold: 200,
          styleDriftWordCountRatio: 4,
          styleDriftCharsPerSecRatio: 3.0,
          styleDriftFormattingDiff: 5,
          dampeningThreshold: 0.8,
        },
      }),
    }]);
    const settings = await getOrgIntegritySettings(db, 'user-1');
    expect(settings).toEqual({
      charsPerSecondThreshold: 15,  // MIN(15, 20) = 15 (strictest)
      formattingScoreThreshold: 3,  // MIN(3, 5) = 3 (strictest)
      wordCountThreshold: 150,      // MIN(150, 200) = 150 (strictest)
      styleDriftWordCountRatio: 3,  // MIN(3, 4) = 3 (strictest)
      styleDriftCharsPerSecRatio: 2.5, // MIN(2.5, 3.0) = 2.5 (strictest)
      styleDriftFormattingDiff: 3,  // MIN(3, 5) = 3 (strictest)
      emaAlpha: 0.3,
      dampeningThreshold: 0.8,     // MAX(0.5, 0.8) = 0.8 (strictest)
    });
  });

  it('applies custom settings that are stricter than defaults', async () => {
    const db = createMockDb([{
      metadata: JSON.stringify({
        integritySettings: {
          charsPerSecondThreshold: 10,
          formattingScoreThreshold: 2,
          wordCountThreshold: 100,
          dampeningThreshold: 0.9,
        },
      }),
    }]);
    const settings = await getOrgIntegritySettings(db, 'user-1');
    expect(settings.charsPerSecondThreshold).toBe(10);
    expect(settings.formattingScoreThreshold).toBe(2);
    expect(settings.wordCountThreshold).toBe(100);
    expect(settings.dampeningThreshold).toBe(0.9);
  });

  it('picks strictest settings across multiple orgs (MIN for thresholds, MAX for dampening)', async () => {
    const db = createMockDb([
      { metadata: JSON.stringify({ integritySettings: { charsPerSecondThreshold: 10, dampeningThreshold: 0.5 } }) },
      { metadata: JSON.stringify({ integritySettings: { charsPerSecondThreshold: 20, dampeningThreshold: 0.8 } }) },
    ]);
    const settings = await getOrgIntegritySettings(db, 'user-1');
    // Strictest: lower threshold = stricter, higher dampening = stricter
    expect(settings.charsPerSecondThreshold).toBe(10);
    expect(settings.dampeningThreshold).toBe(0.8);
  });

  it('returns EXEMPT when integrityExempt is true', async () => {
    const db = createMockDb([{ metadata: '{"integrityExempt": true}' }]);
    const settings = await getOrgIntegritySettings(db, 'user-1');
    expect(settings).toEqual({
      charsPerSecondThreshold: 9999,
      formattingScoreThreshold: 9999,
      wordCountThreshold: 99999,
      styleDriftWordCountRatio: 9999,
      styleDriftCharsPerSecRatio: 9999,
      styleDriftFormattingDiff: 9999,
      emaAlpha: 0.3,
      dampeningThreshold: 0,
    });
  });

  it('ignores malformed metadata JSON', async () => {
    const db = createMockDb([{ metadata: 'not json' }]);
    const settings = await getOrgIntegritySettings(db, 'user-1');
    expect(settings).toEqual({
      charsPerSecondThreshold: 15,
      formattingScoreThreshold: 3,
      wordCountThreshold: 150,
      styleDriftWordCountRatio: 3,
      styleDriftCharsPerSecRatio: 2.5,
      styleDriftFormattingDiff: 3,
      emaAlpha: 0.3,
      dampeningThreshold: 0.5,
    });
  });
});
