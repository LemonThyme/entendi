import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../api/db/connection.js';
import { conceptAnalytics, dailySnapshots } from '../api/db/schema.js';

interface DailySnapshotInput {
  userId: string;
  eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
  conceptId: string;
  domain: string | null;
  masteryDelta: number;
  integrityScore: number | undefined;
}

export function buildDailySnapshotUpsert(input: DailySnapshotInput) {
  const today = new Date().toISOString().slice(0, 10);
  const isProbe = input.eventType === 'probe';
  const isTutor = input.eventType === 'tutor_phase1' || input.eventType === 'tutor_phase4';

  return {
    userId: input.userId,
    date: today,
    assessmentCount: 1,
    conceptsAssessed: 1,
    avgMasteryDelta: input.masteryDelta,
    totalDismissals: 0,
    avgIntegrityScore: input.integrityScore ?? null,
    probeCount: isProbe ? 1 : 0,
    tutorCount: isTutor ? 1 : 0,
    domains: input.domain ? { [input.domain]: 1 } : {},
  };
}

interface ConceptAnalyticsInput {
  userId: string;
  conceptId: string;
  eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
  rubricScore: number;
  mastery: number;
  responseWordCount: number | undefined;
  integrityScore: number | undefined;
  existing: {
    totalProbes: number;
    totalTutorSessions: number;
    totalDismissals: number;
    peakMastery: number;
    currentStreak: number;
    longestStreak: number;
    avgResponseWordCount: number | null;
    avgIntegrityScore: number | null;
  } | null;
}

export function buildConceptAnalyticsUpsert(input: ConceptAnalyticsInput) {
  const { existing, eventType, rubricScore, mastery } = input;
  const isProbe = eventType === 'probe';
  const isTutor = eventType === 'tutor_phase1' || eventType === 'tutor_phase4';
  const isPassing = rubricScore >= 2;

  const totalProbes = (existing?.totalProbes ?? 0) + (isProbe ? 1 : 0);
  const totalTutorSessions = (existing?.totalTutorSessions ?? 0) + (isTutor ? 1 : 0);
  const peakMastery = Math.max(existing?.peakMastery ?? 0, mastery);
  const currentStreak = isPassing ? (existing?.currentStreak ?? 0) + 1 : 0;
  const longestStreak = Math.max(existing?.longestStreak ?? 0, currentStreak);

  // Running average for response word count
  const prevCount = (existing?.totalProbes ?? 0) + (existing?.totalTutorSessions ?? 0);
  const prevAvgWords = existing?.avgResponseWordCount ?? 0;
  const newWordCount = input.responseWordCount ?? 0;
  const avgResponseWordCount = prevCount > 0
    ? (prevAvgWords * prevCount + newWordCount) / (prevCount + 1)
    : newWordCount;

  // Running average for integrity score
  const prevAvgIntegrity = existing?.avgIntegrityScore ?? null;
  let avgIntegrityScore: number | null;
  if (input.integrityScore !== undefined) {
    avgIntegrityScore = prevAvgIntegrity !== null && prevCount > 0
      ? (prevAvgIntegrity * prevCount + input.integrityScore) / (prevCount + 1)
      : input.integrityScore;
  } else {
    avgIntegrityScore = prevAvgIntegrity;
  }

  return {
    userId: input.userId,
    conceptId: input.conceptId,
    totalProbes,
    totalTutorSessions,
    totalDismissals: existing?.totalDismissals ?? 0,
    peakMastery,
    currentStreak,
    longestStreak,
    avgResponseWordCount: avgResponseWordCount ?? null,
    avgIntegrityScore,
  };
}

/**
 * Called after every assessment event insert.
 * Upserts daily_snapshots and concept_analytics rows.
 */
export async function updateAnalyticsSnapshots(
  db: Database,
  input: DailySnapshotInput & {
    rubricScore: number;
    mastery: number;
    responseWordCount: number | undefined;
  },
) {
  // 1. Upsert daily_snapshots
  const dsValues = buildDailySnapshotUpsert(input);
  await db.insert(dailySnapshots)
    .values(dsValues)
    .onConflictDoUpdate({
      target: [dailySnapshots.userId, dailySnapshots.date],
      set: {
        assessmentCount: sql`${dailySnapshots.assessmentCount} + 1`,
        conceptsAssessed: sql`CASE WHEN ${dailySnapshots.domains} ? ${input.domain ?? ''} THEN ${dailySnapshots.conceptsAssessed} ELSE ${dailySnapshots.conceptsAssessed} + 1 END`,
        avgMasteryDelta: sql`(${dailySnapshots.avgMasteryDelta} * ${dailySnapshots.assessmentCount} + ${input.masteryDelta}) / (${dailySnapshots.assessmentCount} + 1)`,
        probeCount: sql`${dailySnapshots.probeCount} + ${dsValues.probeCount}`,
        tutorCount: sql`${dailySnapshots.tutorCount} + ${dsValues.tutorCount}`,
        domains: input.domain
          ? sql`jsonb_set(${dailySnapshots.domains}, ${`{${input.domain}}`}::text[], to_jsonb(COALESCE((${dailySnapshots.domains}->>${ input.domain})::int, 0) + 1))`
          : sql`${dailySnapshots.domains}`,
        avgIntegrityScore: input.integrityScore !== undefined
          ? sql`CASE WHEN ${dailySnapshots.avgIntegrityScore} IS NULL THEN ${input.integrityScore}
                ELSE (${dailySnapshots.avgIntegrityScore} * ${dailySnapshots.assessmentCount} + ${input.integrityScore}) / (${dailySnapshots.assessmentCount} + 1) END`
          : sql`${dailySnapshots.avgIntegrityScore}`,
      },
    });

  // 2. Upsert concept_analytics
  const [existing] = await db.select().from(conceptAnalytics)
    .where(and(eq(conceptAnalytics.userId, input.userId), eq(conceptAnalytics.conceptId, input.conceptId)));

  const caValues = buildConceptAnalyticsUpsert({
    ...input,
    existing: existing ?? null,
  });

  if (existing) {
    await db.update(conceptAnalytics).set({
      lastAssessedAt: new Date(),
      ...caValues,
    }).where(and(
      eq(conceptAnalytics.userId, input.userId),
      eq(conceptAnalytics.conceptId, input.conceptId),
    ));
  } else {
    await db.insert(conceptAnalytics).values({
      ...caValues,
      firstAssessedAt: new Date(),
      lastAssessedAt: new Date(),
    });
  }
}
