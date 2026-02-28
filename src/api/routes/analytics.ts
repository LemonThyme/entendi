import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { masteryRange, pMastery } from '../../core/mastery-display.js';
import {
  assessmentEvents,
  conceptAnalytics,
  conceptEdges,
  concepts,
  dailySnapshots,
  dismissalEvents,
  tutorSessions,
  userConceptStates,
} from '../db/schema.js';
import type { Env } from '../index.js';
import { requireAuth } from '../middleware/auth.js';

export const analyticsRoutes = new Hono<Env>();
analyticsRoutes.use('*', requireAuth);

// GET /timeline/:conceptId — mastery over time for one concept
analyticsRoutes.get('/timeline/:conceptId', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const conceptId = c.req.param('conceptId');

  const events = await db.select({
    id: assessmentEvents.id,
    eventType: assessmentEvents.eventType,
    rubricScore: assessmentEvents.rubricScore,
    muBefore: assessmentEvents.muBefore,
    muAfter: assessmentEvents.muAfter,
    createdAt: assessmentEvents.createdAt,
    integrityScore: assessmentEvents.integrityScore,
  }).from(assessmentEvents)
    .where(and(
      eq(assessmentEvents.userId, user.id),
      eq(assessmentEvents.conceptId, conceptId),
    ))
    .orderBy(asc(assessmentEvents.createdAt))
    .limit(200);

  // Get current sigma for confidence band on latest point
  const [state] = await db.select().from(userConceptStates)
    .where(and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, conceptId)));

  // Build timeline points with estimated sigma at each point
  const initialSigma = 1.5;
  const points = events.map((ev, i) => {
    const estimatedSigma = initialSigma / Math.sqrt(1 + i * 0.5);
    const range = masteryRange(ev.muAfter, estimatedSigma);
    return {
      eventId: ev.id,
      timestamp: ev.createdAt,
      mastery: range,
      eventType: ev.eventType,
      rubricScore: ev.rubricScore,
      integrityScore: ev.integrityScore,
    };
  });

  return c.json({
    conceptId,
    currentMastery: state ? masteryRange(state.mu, state.sigma) : null,
    timeline: points,
  });
});

// GET /timeline — aggregate mastery timeline across all concepts
analyticsRoutes.get('/timeline', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const events = await db.select({
    muBefore: assessmentEvents.muBefore,
    muAfter: assessmentEvents.muAfter,
    createdAt: assessmentEvents.createdAt,
  }).from(assessmentEvents)
    .where(eq(assessmentEvents.userId, user.id))
    .orderBy(asc(assessmentEvents.createdAt))
    .limit(500);

  // Group by day and compute average mastery delta
  const byDay: Record<string, { count: number; totalDelta: number; avgMastery: number }> = {};
  for (const ev of events) {
    const day = new Date(ev.createdAt).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { count: 0, totalDelta: 0, avgMastery: 0 };
    byDay[day].count++;
    byDay[day].totalDelta += pMastery(ev.muAfter) - pMastery(ev.muBefore);
    byDay[day].avgMastery = pMastery(ev.muAfter);
  }

  const timeline = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      assessments: data.count,
      avgDelta: Math.round(data.totalDelta / data.count * 100) / 100,
      cumulativeDelta: 0, // filled below
    }));

  let cumulative = 0;
  for (const point of timeline) {
    cumulative += point.avgDelta;
    point.cumulativeDelta = Math.round(cumulative * 100) / 100;
  }

  return c.json({ timeline });
});

// GET /velocity — learning velocity over rolling windows
analyticsRoutes.get('/velocity', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const snapshots = await db.select().from(dailySnapshots)
    .where(eq(dailySnapshots.userId, user.id))
    .orderBy(desc(dailySnapshots.date))
    .limit(90);

  const now = Date.now();
  const windows = { '7d': 7, '30d': 30, '90d': 90 };
  const result: Record<string, { assessments: number; avgDelta: number; conceptsAssessed: number }> = {};

  for (const [label, days] of Object.entries(windows)) {
    const cutoff = new Date(now - days * 86400000).toISOString().slice(0, 10);
    const inWindow = snapshots.filter(s => s.date >= cutoff);
    const totalAssessments = inWindow.reduce((sum, s) => sum + s.assessmentCount, 0);
    const totalDelta = inWindow.reduce((sum, s) => sum + s.avgMasteryDelta * s.assessmentCount, 0);
    const totalConcepts = inWindow.reduce((sum, s) => sum + s.conceptsAssessed, 0);
    result[label] = {
      assessments: totalAssessments,
      avgDelta: totalAssessments > 0 ? Math.round(totalDelta / totalAssessments * 100) / 100 : 0,
      conceptsAssessed: totalConcepts,
    };
  }

  return c.json({ velocity: result, snapshots: snapshots.reverse() });
});

// GET /activity-heatmap — daily assessment counts for calendar heatmap
analyticsRoutes.get('/activity-heatmap', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const days = parseInt(c.req.query('days') || '365', 10);

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const snapshots = await db.select({
    date: dailySnapshots.date,
    assessmentCount: dailySnapshots.assessmentCount,
    conceptsAssessed: dailySnapshots.conceptsAssessed,
    avgMasteryDelta: dailySnapshots.avgMasteryDelta,
    domains: dailySnapshots.domains,
  }).from(dailySnapshots)
    .where(and(
      eq(dailySnapshots.userId, user.id),
      gte(dailySnapshots.date, cutoff),
    ))
    .orderBy(asc(dailySnapshots.date));

  return c.json({ heatmap: snapshots });
});

// GET /concept/:conceptId — full concept profile
analyticsRoutes.get('/concept/:conceptId', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const conceptId = c.req.param('conceptId');

  const [conceptRow] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  if (!conceptRow) return c.json({ error: 'Concept not found' }, 404);

  const [
    [state],
    [analytics],
    events,
    tutorHistory,
    dismissals,
    prerequisites,
  ] = await Promise.all([
    db.select().from(userConceptStates)
      .where(and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, conceptId))),
    db.select().from(conceptAnalytics)
      .where(and(eq(conceptAnalytics.userId, user.id), eq(conceptAnalytics.conceptId, conceptId))),
    db.select().from(assessmentEvents)
      .where(and(eq(assessmentEvents.userId, user.id), eq(assessmentEvents.conceptId, conceptId)))
      .orderBy(asc(assessmentEvents.createdAt))
      .limit(200),
    db.select().from(tutorSessions)
      .where(and(eq(tutorSessions.userId, user.id), eq(tutorSessions.conceptId, conceptId)))
      .orderBy(desc(tutorSessions.startedAt)),
    db.select().from(dismissalEvents)
      .where(and(eq(dismissalEvents.userId, user.id), eq(dismissalEvents.conceptId, conceptId)))
      .orderBy(desc(dismissalEvents.createdAt)),
    db.select().from(conceptEdges)
      .where(and(eq(conceptEdges.sourceId, conceptId), eq(conceptEdges.edgeType, 'requires'))),
  ]);

  // Get mastery for prerequisites
  const prereqStates = prerequisites.length > 0
    ? await db.select().from(userConceptStates)
      .where(and(
        eq(userConceptStates.userId, user.id),
        sql`${userConceptStates.conceptId} IN (${sql.join(prerequisites.map(p => sql`${p.targetId}`), sql`, `)})`,
      ))
    : [];

  return c.json({
    concept: { id: conceptRow.id, domain: conceptRow.domain, specificity: conceptRow.specificity, description: conceptRow.description },
    mastery: state ? masteryRange(state.mu, state.sigma) : null,
    analytics: analytics ?? null,
    timeline: [
      ...events.map((ev, i) => {
        const estimatedSigma = 1.5 / Math.sqrt(1 + i * 0.5);
        return {
          type: 'assessment' as const,
          eventId: ev.id,
          timestamp: ev.createdAt,
          mastery: masteryRange(ev.muAfter, estimatedSigma),
          eventType: ev.eventType,
          rubricScore: ev.rubricScore,
          integrityScore: ev.integrityScore,
          responseText: ev.responseText,
        };
      }),
      ...dismissals.map(d => ({
        type: 'dismissal' as const,
        eventId: d.id,
        timestamp: d.createdAt,
        reason: d.reason,
        note: d.note,
        requeued: d.requeued,
        resolvedAs: d.resolvedAs,
      })),
    ].sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime()),
    tutorSessions: tutorHistory,
    dismissals,
    prerequisites: prerequisites.map(p => {
      const prereqState = prereqStates.find(s => s.conceptId === p.targetId);
      return {
        conceptId: p.targetId,
        mastery: prereqState ? masteryRange(prereqState.mu, prereqState.sigma) : null,
      };
    }),
  });
});
