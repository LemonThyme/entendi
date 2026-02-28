import { describe, expect, it } from 'vitest';
import { conceptAnalytics, dailySnapshots, zpdSnapshots } from '../../../src/api/db/schema.js';

describe('Analytics schema tables', () => {
  it('dailySnapshots has expected columns', () => {
    const cols = Object.keys(dailySnapshots);
    expect(cols).toContain('userId');
    expect(cols).toContain('date');
    expect(cols).toContain('assessmentCount');
    expect(cols).toContain('conceptsAssessed');
    expect(cols).toContain('avgMasteryDelta');
    expect(cols).toContain('totalDismissals');
    expect(cols).toContain('avgIntegrityScore');
    expect(cols).toContain('probeCount');
    expect(cols).toContain('tutorCount');
    expect(cols).toContain('domains');
  });

  it('zpdSnapshots has expected columns', () => {
    const cols = Object.keys(zpdSnapshots);
    expect(cols).toContain('id');
    expect(cols).toContain('userId');
    expect(cols).toContain('conceptId');
    expect(cols).toContain('enteredAt');
    expect(cols).toContain('exitedAt');
    expect(cols).toContain('masteryAtEntry');
    expect(cols).toContain('masteryAtExit');
  });

  it('conceptAnalytics has expected columns', () => {
    const cols = Object.keys(conceptAnalytics);
    expect(cols).toContain('userId');
    expect(cols).toContain('conceptId');
    expect(cols).toContain('firstAssessedAt');
    expect(cols).toContain('lastAssessedAt');
    expect(cols).toContain('totalProbes');
    expect(cols).toContain('totalTutorSessions');
    expect(cols).toContain('totalDismissals');
    expect(cols).toContain('peakMastery');
    expect(cols).toContain('currentStreak');
    expect(cols).toContain('longestStreak');
    expect(cols).toContain('avgResponseWordCount');
    expect(cols).toContain('avgIntegrityScore');
  });
});
