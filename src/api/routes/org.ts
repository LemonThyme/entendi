import { Hono } from 'hono';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { member, user, organization, userConceptStates, assessmentEvents, concepts, eventAnnotations, dismissalEvents } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { pMastery } from '../../schemas/types.js';
import { z } from 'zod';
import type { Env } from '../index.js';
import type { Context } from 'hono';
import type { Database } from '../db/connection.js';

/** Build a SQL fragment for `<col> IN (...)` that works with parameterized queries */
function sqlInIds(col: string, ids: string[]) {
  if (ids.length === 0) return sql`FALSE`;
  return sql.join([sql.raw(`${col} IN (`), sql.join(ids.map(id => sql`${id}`), sql`, `), sql`)`], sql``);
}

export const orgRoutes = new Hono<Env>();

orgRoutes.use('*', requireAuth);

/**
 * Resolve the user's org ID: prefer session.activeOrganizationId,
 * fall back to their first org membership.
 */
async function resolveOrgId(c: Context<Env>): Promise<string | null> {
  const session = c.get('session');
  if (session?.activeOrganizationId) return session.activeOrganizationId;

  const userId = c.get('user')?.id;
  if (!userId) return null;

  const db = c.get('db');
  const [membership] = await db.select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);

  return membership?.organizationId ?? null;
}

// GET /members — list org members with mastery overview
orgRoutes.get('/members', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const members = await db.select({
    userId: member.userId,
    role: member.role,
    name: user.name,
    email: user.email,
  }).from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId));

  // Batch-fetch all concept states for org members in a single query
  const memberIds = members.map(m => m.userId);
  const allStates = memberIds.length > 0
    ? await db.select().from(userConceptStates)
        .where(inArray(userConceptStates.userId, memberIds))
    : [];

  // Group states by userId
  const statesByUser = new Map<string, typeof allStates>();
  for (const s of allStates) {
    let arr = statesByUser.get(s.userId);
    if (!arr) { arr = []; statesByUser.set(s.userId, arr); }
    arr.push(s);
  }

  const result = members.map((m) => {
    const states = statesByUser.get(m.userId) ?? [];
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
  });

  return c.json(result);
});

// GET /members/:userId — detailed member knowledge graph
orgRoutes.get('/members/:userId', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
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

// GET /members/:userId/history — recent assessment events for an org member
orgRoutes.get('/members/:userId/history', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
  const targetUserId = c.req.param('userId');
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  // Verify target user is in the org
  const [membership] = await db.select().from(member)
    .where(eq(member.userId, targetUserId));
  if (!membership || membership.organizationId !== orgId) {
    return c.json({ error: 'User not in organization' }, 403);
  }

  const [events, dismissals] = await Promise.all([
    db.select({
      id: assessmentEvents.id,
      conceptId: assessmentEvents.conceptId,
      eventType: assessmentEvents.eventType,
      rubricScore: assessmentEvents.rubricScore,
      muBefore: assessmentEvents.muBefore,
      muAfter: assessmentEvents.muAfter,
      evaluatorConfidence: assessmentEvents.evaluatorConfidence,
      integrityScore: assessmentEvents.integrityScore,
      responseText: assessmentEvents.responseText,
      evaluationCriteria: assessmentEvents.evaluationCriteria,
      responseFeatures: assessmentEvents.responseFeatures,
      createdAt: assessmentEvents.createdAt,
    }).from(assessmentEvents)
      .where(eq(assessmentEvents.userId, targetUserId))
      .orderBy(desc(assessmentEvents.createdAt))
      .limit(20),
    db.select({
      id: dismissalEvents.id,
      conceptId: dismissalEvents.conceptId,
      reason: dismissalEvents.reason,
      note: dismissalEvents.note,
      requeued: dismissalEvents.requeued,
      resolvedAt: dismissalEvents.resolvedAt,
      resolvedAs: dismissalEvents.resolvedAs,
      createdAt: dismissalEvents.createdAt,
    }).from(dismissalEvents)
      .where(eq(dismissalEvents.userId, targetUserId))
      .orderBy(desc(dismissalEvents.createdAt))
      .limit(20),
  ]);

  // Interleave and sort by date descending
  const history = [
    ...events.map(e => ({ type: 'assessment' as const, ...e })),
    ...dismissals.map(d => ({ type: 'dismissal' as const, ...d })),
  ].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    .slice(0, 20);

  return c.json(history);
});

// GET /members/:userId/integrity — integrity stats for an org member
orgRoutes.get('/members/:userId/integrity', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
  const targetUserId = c.req.param('userId');
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  // Verify target user is in the org
  const [membership] = await db.select().from(member)
    .where(eq(member.userId, targetUserId));
  if (!membership || membership.organizationId !== orgId) {
    return c.json({ error: 'User not in organization' }, 403);
  }

  const dampeningThreshold = 0.5;

  // Get all events with integrity scores for this user
  const integrityResult = await db.execute(sql`
    SELECT
      AVG(integrity_score) as avg_score,
      COUNT(*)::int as total,
      COUNT(CASE WHEN integrity_score < ${dampeningThreshold} THEN 1 END)::int as flagged_count
    FROM assessment_events
    WHERE user_id = ${targetUserId} AND integrity_score IS NOT NULL
  `);

  const row = integrityResult.rows[0] as any;
  const avgIntegrityScore = row?.avg_score ? Number(row.avg_score) : null;
  const flaggedCount = row?.flagged_count ?? 0;
  const totalAssessed = row?.total ?? 0;

  // Get flagged events
  const flaggedEvents = await db.select({
    conceptId: assessmentEvents.conceptId,
    eventType: assessmentEvents.eventType,
    rubricScore: assessmentEvents.rubricScore,
    integrityScore: assessmentEvents.integrityScore,
    createdAt: assessmentEvents.createdAt,
  }).from(assessmentEvents)
    .where(and(
      eq(assessmentEvents.userId, targetUserId),
      sql`integrity_score IS NOT NULL AND integrity_score < ${dampeningThreshold}`
    ))
    .orderBy(desc(assessmentEvents.createdAt))
    .limit(20);

  return c.json({ avgIntegrityScore, flaggedCount, totalAssessed, flaggedEvents });
});

// GET /rankings — mastery leaderboard for org members
orgRoutes.get('/rankings', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const members = await db.select({
    userId: member.userId,
    role: member.role,
    name: user.name,
    email: user.email,
  }).from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, orgId));

  // Batch-fetch all concept states for org members in a single query
  const memberIds = members.map(m => m.userId);
  const allStates = memberIds.length > 0
    ? await db.select().from(userConceptStates)
        .where(inArray(userConceptStates.userId, memberIds))
    : [];

  // Group states by userId
  const statesByUser = new Map<string, typeof allStates>();
  for (const s of allStates) {
    let arr = statesByUser.get(s.userId);
    if (!arr) { arr = []; statesByUser.set(s.userId, arr); }
    arr.push(s);
  }

  const rankings = members.map((m) => {
    const states = statesByUser.get(m.userId) ?? [];
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
  });

  // Sort by mastered count desc, then avgMastery desc
  rankings.sort((a, b) => b.mastered - a.mastered || b.avgMastery - a.avgMastery);

  return c.json(rankings);
});

// GET /analytics — aggregate org analytics
orgRoutes.get('/analytics', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
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
    WHERE ${sqlInIds('user_id', memberIds)}
  `);
  const totalAssessments = Number((totalResult.rows[0] as any)?.count ?? 0);

  // Concept coverage: for each concept, how many org members have assessed it
  const coverageResult = await db.execute(sql`
    SELECT ucs.concept_id, COUNT(DISTINCT ucs.user_id) as assessed_by,
           AVG(ucs.mu) as avg_mu
    FROM user_concept_states ucs
    WHERE ${sqlInIds('user_id', memberIds)} AND ucs.assessment_count > 0
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

const integritySettingsSchema = z.object({
  charsPerSecondThreshold: z.number().min(1).max(100).optional(),
  formattingScoreThreshold: z.number().int().min(0).max(50).optional(),
  wordCountThreshold: z.number().int().min(10).max(2000).optional(),
  styleDriftWordCountRatio: z.number().min(1).max(20).optional(),
  styleDriftCharsPerSecRatio: z.number().min(1).max(20).optional(),
  styleDriftFormattingDiff: z.number().min(0).max(20).optional(),
  dampeningThreshold: z.number().min(0).max(1).optional(),
  emaAlpha: z.number().min(0.01).max(1).optional(),
});

// GET /settings — get org settings (rate limits, etc.)
orgRoutes.get('/settings', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
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
    integritySettings: {
      charsPerSecondThreshold: (settings.integritySettings as any)?.charsPerSecondThreshold ?? 15,
      formattingScoreThreshold: (settings.integritySettings as any)?.formattingScoreThreshold ?? 3,
      wordCountThreshold: (settings.integritySettings as any)?.wordCountThreshold ?? 150,
      styleDriftWordCountRatio: (settings.integritySettings as any)?.styleDriftWordCountRatio ?? 3,
      styleDriftCharsPerSecRatio: (settings.integritySettings as any)?.styleDriftCharsPerSecRatio ?? 2.5,
      styleDriftFormattingDiff: (settings.integritySettings as any)?.styleDriftFormattingDiff ?? 3,
      dampeningThreshold: (settings.integritySettings as any)?.dampeningThreshold ?? 0.5,
      emaAlpha: (settings.integritySettings as any)?.emaAlpha ?? 0.3,
    },
  });
});

// PUT /settings/rate-limits — update org rate limit settings (owner/admin only)
orgRoutes.put('/settings/rate-limits', async (c) => {
  const db = c.get('db');
  const currentUser = c.get('user')!;
  const orgId = await resolveOrgId(c);
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

// PUT /settings/integrity — update org integrity settings (owner/admin only)
orgRoutes.put('/settings/integrity', async (c) => {
  const db = c.get('db');
  const currentUser = c.get('user')!;
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  // Verify user is owner or admin
  const [membership] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.userId, currentUser.id), eq(member.organizationId, orgId)));
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return c.json({ error: 'Only org owners and admins can update settings' }, 403);
  }

  const raw = await c.req.json();
  const parsed = integritySettingsSchema.safeParse(raw);
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

  // Merge integrity settings
  const currentIs = (existing.integritySettings as Record<string, unknown>) ?? {};
  existing.integritySettings = { ...currentIs, ...parsed.data };

  await db.update(organization).set({ metadata: JSON.stringify(existing) })
    .where(eq(organization.id, orgId));

  return c.json({
    integritySettings: existing.integritySettings,
  });
});

// GET /integrity — aggregate integrity analytics for org
orgRoutes.get('/integrity', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  // Get org members
  const members = await db.select({ userId: member.userId }).from(member)
    .where(eq(member.organizationId, orgId));
  const memberIds = members.map(m => m.userId);
  if (memberIds.length === 0) return c.json({ totalWithIntegrity: 0, avgScore: null, flaggedCount: 0, flaggedMemberCount: 0 });

  // Get org's dampening threshold for flagging cutoff
  const [org] = await db.select({ metadata: organization.metadata })
    .from(organization).where(eq(organization.id, orgId));
  let dampeningThreshold = 0.5;
  if (org?.metadata) {
    try {
      const parsed = JSON.parse(org.metadata);
      if (typeof parsed.integritySettings?.dampeningThreshold === 'number') {
        dampeningThreshold = parsed.integritySettings.dampeningThreshold;
      }
    } catch { /* ignore */ }
  }

  // Aggregate query
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int as total,
      AVG(integrity_score) as avg_score,
      COUNT(CASE WHEN integrity_score < ${dampeningThreshold} THEN 1 END)::int as flagged_count,
      COUNT(DISTINCT CASE WHEN integrity_score < ${dampeningThreshold} THEN user_id END)::int as flagged_members
    FROM assessment_events
    WHERE ${sqlInIds('user_id', memberIds)} AND integrity_score IS NOT NULL
  `);

  const row = result.rows[0] as any;
  return c.json({
    totalWithIntegrity: row?.total ?? 0,
    avgScore: row?.avg_score ? Number(row.avg_score) : null,
    flaggedCount: row?.flagged_count ?? 0,
    flaggedMemberCount: row?.flagged_members ?? 0,
  });
});

// GET /integrity/flagged — paginated list of flagged assessment events
orgRoutes.get('/integrity/flagged', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const page = Math.max(1, Number(c.req.query('page') || '1'));
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') || '20')));
  const offset = (page - 1) * limit;

  const members = await db.select({ userId: member.userId }).from(member)
    .where(eq(member.organizationId, orgId));
  const memberIds = members.map(m => m.userId);
  if (memberIds.length === 0) return c.json({ items: [], total: 0, page, limit });

  // Get org's dampening threshold
  const [org] = await db.select({ metadata: organization.metadata })
    .from(organization).where(eq(organization.id, orgId));
  let dampeningThreshold = 0.5;
  if (org?.metadata) {
    try {
      const parsed = JSON.parse(org.metadata);
      if (typeof parsed.integritySettings?.dampeningThreshold === 'number') {
        dampeningThreshold = parsed.integritySettings.dampeningThreshold;
      }
    } catch { /* ignore */ }
  }

  // Count total
  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM assessment_events
    WHERE ${sqlInIds('user_id', memberIds)} AND integrity_score IS NOT NULL AND integrity_score < ${dampeningThreshold}
  `);
  const total = (countResult.rows[0] as any)?.total ?? 0;

  // Fetch page
  const items = await db.execute(sql`
    SELECT ae.id, ae.user_id, u.name as user_name, u.email as user_email,
           ae.concept_id, ae.integrity_score, ae.response_features,
           ae.event_type, ae.rubric_score, ae.created_at
    FROM assessment_events ae
    JOIN "user" u ON ae.user_id = u.id
    WHERE ${sqlInIds('ae.user_id', memberIds)} AND ae.integrity_score IS NOT NULL AND ae.integrity_score < ${dampeningThreshold}
    ORDER BY ae.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return c.json({
    items: items.rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      conceptId: r.concept_id,
      integrityScore: Number(r.integrity_score),
      responseFeatures: r.response_features,
      eventType: r.event_type,
      rubricScore: r.rubric_score,
      createdAt: r.created_at,
    })),
    total,
    page,
    limit,
  });
});

// GET /events/:eventId — full event detail for any org member's event
orgRoutes.get('/events/:eventId', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const eventId = parseInt(c.req.param('eventId'));
  if (isNaN(eventId)) return c.json({ error: 'Invalid event ID' }, 400);

  // Fetch event + concept info
  const [event] = await db.select({
    id: assessmentEvents.id,
    userId: assessmentEvents.userId,
    conceptId: assessmentEvents.conceptId,
    conceptName: concepts.id,
    domain: concepts.domain,
    eventType: assessmentEvents.eventType,
    rubricScore: assessmentEvents.rubricScore,
    evaluatorConfidence: assessmentEvents.evaluatorConfidence,
    muBefore: assessmentEvents.muBefore,
    muAfter: assessmentEvents.muAfter,
    probeDepth: assessmentEvents.probeDepth,
    responseText: assessmentEvents.responseText,
    evaluationCriteria: assessmentEvents.evaluationCriteria,
    responseFeatures: assessmentEvents.responseFeatures,
    integrityScore: assessmentEvents.integrityScore,
    tutored: assessmentEvents.tutored,
    createdAt: assessmentEvents.createdAt,
  }).from(assessmentEvents)
    .innerJoin(concepts, eq(assessmentEvents.conceptId, concepts.id))
    .where(eq(assessmentEvents.id, eventId));

  if (!event) return c.json({ error: 'Event not found' }, 404);

  // Verify event's user is in the caller's org
  const [membership] = await db.select().from(member)
    .where(and(eq(member.userId, event.userId), eq(member.organizationId, orgId)));
  if (!membership) return c.json({ error: 'Event user not in organization' }, 403);

  // Fetch annotations with author names
  const annotations = await db.select({
    id: eventAnnotations.id,
    authorId: eventAnnotations.authorId,
    authorName: user.name,
    text: eventAnnotations.text,
    createdAt: eventAnnotations.createdAt,
  }).from(eventAnnotations)
    .innerJoin(user, eq(eventAnnotations.authorId, user.id))
    .where(eq(eventAnnotations.eventId, eventId))
    .orderBy(desc(eventAnnotations.createdAt));

  return c.json({ ...event, annotations });
});

// POST /events/:eventId/annotations — create annotation (org admin/owner only)
orgRoutes.post('/events/:eventId/annotations', async (c) => {
  const db = c.get('db');
  const currentUser = c.get('user')!;
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const eventId = parseInt(c.req.param('eventId'));
  if (isNaN(eventId)) return c.json({ error: 'Invalid event ID' }, 400);

  // Verify caller is admin/owner
  const [callerMembership] = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.userId, currentUser.id), eq(member.organizationId, orgId)));
  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    return c.json({ error: 'Only org owners and admins can annotate events' }, 403);
  }

  // Verify event exists and belongs to an org member
  const [event] = await db.select({ userId: assessmentEvents.userId })
    .from(assessmentEvents).where(eq(assessmentEvents.id, eventId));
  if (!event) return c.json({ error: 'Event not found' }, 404);

  const [eventUserMembership] = await db.select().from(member)
    .where(and(eq(member.userId, event.userId), eq(member.organizationId, orgId)));
  if (!eventUserMembership) return c.json({ error: 'Event user not in organization' }, 403);

  // Validate body
  const body = await c.req.json();
  const parsed = z.object({ text: z.string().min(1).max(2000) }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation error', details: parsed.error.issues }, 400);

  const [annotation] = await db.insert(eventAnnotations).values({
    eventId,
    authorId: currentUser.id,
    text: parsed.data.text,
  }).returning();

  return c.json({ ...annotation, authorName: currentUser.name }, 201);
});

// DELETE /annotations/:annotationId — delete own annotation
orgRoutes.delete('/annotations/:annotationId', async (c) => {
  const db = c.get('db');
  const currentUser = c.get('user')!;

  const annotationId = parseInt(c.req.param('annotationId'));
  if (isNaN(annotationId)) return c.json({ error: 'Invalid annotation ID' }, 400);

  const [annotation] = await db.select().from(eventAnnotations)
    .where(eq(eventAnnotations.id, annotationId));
  if (!annotation) return c.json({ error: 'Annotation not found' }, 404);

  if (annotation.authorId !== currentUser.id) {
    return c.json({ error: 'Can only delete your own annotations' }, 403);
  }

  await db.delete(eventAnnotations).where(eq(eventAnnotations.id, annotationId));

  return c.body(null, 204);
});

// GET /dismissals — paginated list of dismissal events for org members
orgRoutes.get('/dismissals', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const page = Math.max(1, Number(c.req.query('page') || '1'));
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') || '20')));
  const offset = (page - 1) * limit;
  const reasonFilter = c.req.query('reason');
  const userIdFilter = c.req.query('userId');
  const conceptIdFilter = c.req.query('conceptId');

  // Get org member IDs
  const members = await db.select({ userId: member.userId }).from(member)
    .where(eq(member.organizationId, orgId));
  const memberIds = members.map(m => m.userId);
  if (memberIds.length === 0) return c.json({ items: [], total: 0, page, limit });

  // Build WHERE clauses
  const conditions = [sqlInIds('de.user_id', memberIds)];
  if (reasonFilter) conditions.push(sql`de.reason = ${reasonFilter}`);
  if (userIdFilter) conditions.push(sql`de.user_id = ${userIdFilter}`);
  if (conceptIdFilter) conditions.push(sql`de.concept_id = ${conceptIdFilter}`);
  const whereClause = sql.join(conditions, sql` AND `);

  // Count total
  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM dismissal_events de WHERE ${whereClause}
  `);
  const total = (countResult.rows[0] as any)?.total ?? 0;

  // Fetch page
  const items = await db.execute(sql`
    SELECT de.id, de.user_id, u.name as user_name, de.concept_id, c.domain,
           de.reason, de.note, de.requeued, de.resolved_at, de.resolved_as, de.created_at
    FROM dismissal_events de
    JOIN "user" u ON de.user_id = u.id
    JOIN concepts c ON de.concept_id = c.id
    WHERE ${whereClause}
    ORDER BY de.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return c.json({
    items: items.rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      conceptId: r.concept_id,
      domain: r.domain,
      reason: r.reason,
      note: r.note,
      requeued: r.requeued,
      resolvedAt: r.resolved_at,
      resolvedAs: r.resolved_as,
      createdAt: r.created_at,
    })),
    total,
    page,
    limit,
  });
});

// GET /dismissals/stats — aggregate dismissal statistics for org
orgRoutes.get('/dismissals/stats', async (c) => {
  const db = c.get('db');
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const members = await db.select({ userId: member.userId }).from(member)
    .where(eq(member.organizationId, orgId));
  const memberIds = members.map(m => m.userId);
  if (memberIds.length === 0) {
    return c.json({
      totalDismissals: 0,
      byReason: { topic_change: 0, busy: 0, claimed_expertise: 0 },
      topDismissers: [],
      repeatBusyDeferrals: [],
    });
  }

  const memberFilter = sqlInIds('de.user_id', memberIds);

  // Counts by reason
  const byReasonResult = await db.execute(sql`
    SELECT de.reason, COUNT(*)::int as count
    FROM dismissal_events de
    WHERE ${memberFilter}
    GROUP BY de.reason
  `);
  const byReason: Record<string, number> = { topic_change: 0, busy: 0, claimed_expertise: 0 };
  let totalDismissals = 0;
  for (const row of byReasonResult.rows as any[]) {
    byReason[row.reason] = row.count;
    totalDismissals += row.count;
  }

  // Top 5 dismissers
  const topResult = await db.execute(sql`
    SELECT de.user_id, u.name as user_name, COUNT(*)::int as count
    FROM dismissal_events de
    JOIN "user" u ON de.user_id = u.id
    WHERE ${memberFilter}
    GROUP BY de.user_id, u.name
    ORDER BY count DESC
    LIMIT 5
  `);
  const topDismissers = (topResult.rows as any[]).map(r => ({
    userId: r.user_id,
    userName: r.user_name,
    count: r.count,
  }));

  // Repeat busy deferrals (same user+concept, 2+ times)
  const repeatResult = await db.execute(sql`
    SELECT de.user_id, u.name as user_name, de.concept_id, COUNT(*)::int as count
    FROM dismissal_events de
    JOIN "user" u ON de.user_id = u.id
    WHERE ${memberFilter} AND de.reason = 'busy'
    GROUP BY de.user_id, u.name, de.concept_id
    HAVING COUNT(*) >= 2
    ORDER BY count DESC
    LIMIT 20
  `);
  const repeatBusyDeferrals = (repeatResult.rows as any[]).map(r => ({
    userId: r.user_id,
    userName: r.user_name,
    conceptId: r.concept_id,
    count: r.count,
  }));

  return c.json({ totalDismissals, byReason, topDismissers, repeatBusyDeferrals });
});
