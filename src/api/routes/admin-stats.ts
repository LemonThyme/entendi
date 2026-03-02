import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { requireAdmin } from '../middleware/auth.js';

export const adminStatsRoutes = new Hono<Env>();

/**
 * GET /stats — admin-only aggregate metrics.
 */
adminStatsRoutes.get('/stats', requireAdmin, async (c) => {
  const db = c.get('db');

  const [
    usersResult,
    conceptsResult,
    assessmentsResult,
    tutorSessionsResult,
    dismissalsResult,
    assessments24hResult,
    activeUsers7dResult,
  ] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS count FROM "user"`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM concepts`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM assessment_events`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM tutor_sessions`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM dismissal_events`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM assessment_events WHERE created_at > NOW() - INTERVAL '24 hours'`),
    db.execute(sql`SELECT COUNT(DISTINCT user_id)::int AS count FROM assessment_events WHERE created_at > NOW() - INTERVAL '7 days'`),
  ]);

  const count = (result: { rows: unknown[] }) =>
    Number((result.rows[0] as { count: number })?.count ?? 0);

  return c.json({
    totalUsers: count(usersResult),
    totalConcepts: count(conceptsResult),
    totalAssessments: count(assessmentsResult),
    totalTutorSessions: count(tutorSessionsResult),
    totalDismissals: count(dismissalsResult),
    assessmentsLast24h: count(assessments24hResult),
    activeUsersLast7d: count(activeUsers7dResult),
    generatedAt: new Date().toISOString(),
  });
});
