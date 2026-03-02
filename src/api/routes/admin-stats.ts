import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../index.js';

export const adminStatsRoutes = new Hono<Env>();

/**
 * GET /stats — admin-only aggregate metrics.
 * Admin check: user.email must be in ADMIN_EMAILS env var (comma-separated).
 */
adminStatsRoutes.get('/stats', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const adminEmails = (process.env.ADMIN_EMAILS || 'tomaskorenblit@gmail.com')
    .split(',')
    .map((e) => e.trim());

  if (!adminEmails.includes(user.email)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

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
    db.execute(sql`SELECT COUNT(*)::int AS count FROM assessment_events WHERE "createdAt" > NOW() - INTERVAL '24 hours'`),
    db.execute(sql`SELECT COUNT(DISTINCT "userId")::int AS count FROM assessment_events WHERE "createdAt" > NOW() - INTERVAL '7 days'`),
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
