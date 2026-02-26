import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { member, user, organization, userConceptStates, assessmentEvents, concepts } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { pMastery } from '../../schemas/types.js';
import { z } from 'zod';
import type { Env } from '../index.js';

export const orgRoutes = new Hono<Env>();

orgRoutes.use('*', requireAuth);

// GET /members — list org members with mastery overview
orgRoutes.get('/members', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const orgId = session?.activeOrganizationId;
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const members = await db.select({
    userId: member.userId,
    role: member.role,
    name: user.name,
    email: user.email,
  }).from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId));

  // Get mastery overview per member
  const result = await Promise.all(members.map(async (m) => {
    const states = await db.select().from(userConceptStates)
      .where(eq(userConceptStates.userId, m.userId));

    const mastered = states.filter(s => pMastery(s.mu) >= 0.7).length;
    const assessed = states.filter(s => s.assessmentCount > 0).length;

    return {
      ...m,
      mastery: {
        totalAssessed: assessed,
        mastered,
        avgMastery: assessed > 0
          ? states.reduce((sum, s) => sum + pMastery(s.mu), 0) / assessed
          : 0,
      },
    };
  }));

  return c.json(result);
});

// GET /members/:userId — detailed member knowledge graph
orgRoutes.get('/members/:userId', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const orgId = session?.activeOrganizationId;
  const targetUserId = c.req.param('userId');
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  // Verify target user is in the org
  const [membership] = await db.select().from(member)
    .where(eq(member.userId, targetUserId));
  if (!membership || membership.organizationId !== orgId) {
    return c.json({ error: 'User not in organization' }, 403);
  }

  const states = await db.select().from(userConceptStates)
    .where(eq(userConceptStates.userId, targetUserId));

  return c.json({
    userId: targetUserId,
    concepts: states.map(s => ({
      conceptId: s.conceptId,
      mastery: pMastery(s.mu),
      mu: s.mu,
      sigma: s.sigma,
      assessmentCount: s.assessmentCount,
      lastAssessed: s.lastAssessed,
    })),
  });
});

// GET /rankings — mastery leaderboard for org members
orgRoutes.get('/rankings', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const orgId = session?.activeOrganizationId;
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const members = await db.select({
    userId: member.userId,
    role: member.role,
    name: user.name,
    email: user.email,
  }).from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId));

  const rankings = await Promise.all(members.map(async (m) => {
    const states = await db.select().from(userConceptStates)
      .where(eq(userConceptStates.userId, m.userId));

    const assessed = states.filter(s => s.assessmentCount > 0);
    const mastered = assessed.filter(s => pMastery(s.mu) >= 0.7).length;
    const avgMastery = assessed.length > 0
      ? assessed.reduce((sum, s) => sum + pMastery(s.mu), 0) / assessed.length
      : 0;

    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      mastered,
      totalAssessed: assessed.length,
      avgMastery,
    };
  }));

  // Sort by mastered count desc, then avgMastery desc
  rankings.sort((a, b) => b.mastered - a.mastered || b.avgMastery - a.avgMastery);

  return c.json(rankings);
});

// GET /analytics — aggregate org analytics
orgRoutes.get('/analytics', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const orgId = session?.activeOrganizationId;
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  // Get all member user IDs
  const members = await db.select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, orgId));
  const memberIds = members.map(m => m.userId);

  if (memberIds.length === 0) {
    return c.json({ memberCount: 0, totalAssessments: 0, conceptCoverage: [] });
  }

  // Count total assessments
  const totalResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM assessment_events
    WHERE user_id = ANY(${memberIds})
  `);
  const totalAssessments = Number((totalResult.rows[0] as any)?.count ?? 0);

  // Concept coverage: for each concept, how many org members have assessed it
  const coverageResult = await db.execute(sql`
    SELECT ucs.concept_id, COUNT(DISTINCT ucs.user_id) as assessed_by,
           AVG(ucs.mu) as avg_mu
    FROM user_concept_states ucs
    WHERE ucs.user_id = ANY(${memberIds}) AND ucs.assessment_count > 0
    GROUP BY ucs.concept_id
    ORDER BY assessed_by DESC
    LIMIT 20
  `);

  return c.json({
    memberCount: memberIds.length,
    totalAssessments,
    conceptCoverage: (coverageResult.rows as any[]).map(row => ({
      conceptId: row.concept_id,
      assessedBy: Number(row.assessed_by),
      avgMastery: pMastery(Number(row.avg_mu)),
    })),
  });
});

// --- Org Settings ---

const rateLimitsSchema = z.object({
  probeEvalsPerConcept: z.number().int().min(0).max(100).optional(),
  probeEvalWindowHours: z.number().min(0).max(720).optional(),
  probeIntervalSeconds: z.number().int().min(0).max(3600).optional(),
  maxProbesPerHour: z.number().int().min(0).max(1000).optional(),
});

// GET /settings — get org settings (rate limits, etc.)
orgRoutes.get('/settings', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const orgId = session?.activeOrganizationId;
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [org] = await db.select({ metadata: organization.metadata })
    .from(organization).where(eq(organization.id, orgId));
  if (!org) return c.json({ error: 'Organization not found' }, 404);

  let settings: Record<string, unknown> = {};
  if (org.metadata) {
    try { settings = JSON.parse(org.metadata); } catch { /* ignore */ }
  }

  return c.json({
    rateLimitExempt: settings.rateLimitExempt === true,
    rateLimits: {
      probeEvalsPerConcept: (settings.rateLimits as any)?.probeEvalsPerConcept ?? 1,
      probeEvalWindowHours: (settings.rateLimits as any)?.probeEvalWindowHours ?? 24,
      probeIntervalSeconds: (settings.rateLimits as any)?.probeIntervalSeconds ?? 120,
      maxProbesPerHour: (settings.rateLimits as any)?.maxProbesPerHour ?? 15,
    },
  });
});

// PUT /settings/rate-limits — update org rate limit settings (owner/admin only)
orgRoutes.put('/settings/rate-limits', async (c) => {
  const db = c.get('db');
  const currentUser = c.get('user')!;
  const session = c.get('session');
  const orgId = session?.activeOrganizationId;
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  // Verify user is owner or admin
  const [membership] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.userId, currentUser.id), eq(member.organizationId, orgId)));
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return c.json({ error: 'Only org owners and admins can update settings' }, 403);
  }

  const raw = await c.req.json();
  const parsed = rateLimitsSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Validation error', details: parsed.error.issues }, 400);
  }

  const [org] = await db.select({ metadata: organization.metadata })
    .from(organization).where(eq(organization.id, orgId));
  if (!org) return c.json({ error: 'Organization not found' }, 404);

  let existing: Record<string, unknown> = {};
  if (org.metadata) {
    try { existing = JSON.parse(org.metadata); } catch { /* ignore */ }
  }

  // Merge rate limits
  const currentRl = (existing.rateLimits as Record<string, unknown>) ?? {};
  existing.rateLimits = { ...currentRl, ...parsed.data };

  // If all limits are 0, set rateLimitExempt for convenience
  const rl = existing.rateLimits as Record<string, number>;
  const allZero = rl.probeEvalsPerConcept === 0 && rl.probeEvalWindowHours === 0 &&
    rl.probeIntervalSeconds === 0 && rl.maxProbesPerHour === 0;
  existing.rateLimitExempt = allZero;

  await db.update(organization).set({ metadata: JSON.stringify(existing) })
    .where(eq(organization.id, orgId));

  return c.json({
    rateLimitExempt: existing.rateLimitExempt,
    rateLimits: existing.rateLimits,
  });
});
