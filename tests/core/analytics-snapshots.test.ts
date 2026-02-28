import { describe, expect, it } from 'vitest';
import { buildConceptAnalyticsUpsert, buildDailySnapshotUpsert } from '../../src/core/analytics-snapshots.js';

describe('buildDailySnapshotUpsert', () => {
  it('computes correct values for a probe event', () => {
    const result = buildDailySnapshotUpsert({
      userId: 'user1',
      eventType: 'probe',
      conceptId: 'react-hooks',
      domain: 'react',
      masteryDelta: 0.05,
      integrityScore: 0.9,
    });
    expect(result.userId).toBe('user1');
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.assessmentCount).toBe(1);
    expect(result.probeCount).toBe(1);
    expect(result.tutorCount).toBe(0);
    expect(result.avgMasteryDelta).toBeCloseTo(0.05);
    expect(result.domains).toEqual({ react: 1 });
  });

  it('computes correct values for a tutor event', () => {
    const result = buildDailySnapshotUpsert({
      userId: 'user1',
      eventType: 'tutor_phase4',
      conceptId: 'typescript',
      domain: 'typescript',
      masteryDelta: 0.1,
      integrityScore: undefined,
    });
    expect(result.probeCount).toBe(0);
    expect(result.tutorCount).toBe(1);
    expect(result.avgIntegrityScore).toBeNull();
  });
});

describe('buildConceptAnalyticsUpsert', () => {
  it('computes insert values for first assessment', () => {
    const result = buildConceptAnalyticsUpsert({
      userId: 'user1',
      conceptId: 'react-hooks',
      eventType: 'probe',
      rubricScore: 2,
      mastery: 0.65,
      responseWordCount: 45,
      integrityScore: 0.85,
      existing: null,
    });
    expect(result.totalProbes).toBe(1);
    expect(result.totalTutorSessions).toBe(0);
    expect(result.peakMastery).toBeCloseTo(0.65);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });

  it('increments streak for passing score', () => {
    const result = buildConceptAnalyticsUpsert({
      userId: 'user1',
      conceptId: 'react-hooks',
      eventType: 'probe',
      rubricScore: 2,
      mastery: 0.75,
      responseWordCount: 60,
      integrityScore: 0.9,
      existing: { totalProbes: 3, totalTutorSessions: 0, totalDismissals: 0, peakMastery: 0.7, currentStreak: 2, longestStreak: 2, avgResponseWordCount: 50, avgIntegrityScore: 0.85 },
    });
    expect(result.totalProbes).toBe(4);
    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
    expect(result.peakMastery).toBeCloseTo(0.75);
  });

  it('resets streak for failing score', () => {
    const result = buildConceptAnalyticsUpsert({
      userId: 'user1',
      conceptId: 'react-hooks',
      eventType: 'probe',
      rubricScore: 0,
      mastery: 0.3,
      responseWordCount: 10,
      integrityScore: 0.5,
      existing: { totalProbes: 3, totalTutorSessions: 0, totalDismissals: 0, peakMastery: 0.7, currentStreak: 5, longestStreak: 5, avgResponseWordCount: 50, avgIntegrityScore: 0.85 },
    });
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(5); // preserved
  });
});
