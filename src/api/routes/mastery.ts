import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { assessmentEvents, userConceptStates } from '../db/schema.js';
import type { Env } from '../index.js';
import { requireAuth } from '../middleware/auth.js';

export const masteryRoutes = new Hono<Env>();

// All mastery routes require authentication
masteryRoutes.use('*', requireAuth);

// Get all mastery states for the authenticated user
masteryRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const states = await db.select().from(userConceptStates)
    .where(eq(userConceptStates.userId, user.id));
  return c.json(states);
});

// ZPD frontier for the authenticated user
masteryRoutes.get('/zpd-frontier', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const threshold = parseFloat(c.req.query('threshold') || '0.7');

  const result = await db.execute(sql`
    SELECT c.id, c.domain, c.specificity,
           COALESCE(ucs.mu, 0) AS mu,
           COALESCE(ucs.sigma, 1.5) AS sigma
    FROM concepts c
    LEFT JOIN user_concept_states ucs ON ucs.concept_id = c.id AND ucs.user_id = ${user.id}
    WHERE (1.0 / (1.0 + EXP(-COALESCE(ucs.mu, 0)))) < ${threshold}
      AND NOT EXISTS (
        SELECT 1 FROM concept_edges ce
        LEFT JOIN user_concept_states pucs ON pucs.concept_id = ce.target_id AND pucs.user_id = ${user.id}
        WHERE ce.source_id = c.id
          AND ce.edge_type = 'requires'
          AND (1.0 / (1.0 + EXP(-COALESCE(pucs.mu, 0)))) < ${threshold}
      )
    ORDER BY c.id
  `);

  return c.json({ frontier: result.rows });
});

// Get mastery for a specific concept
masteryRoutes.get('/:conceptId', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const conceptId = c.req.param('conceptId');

  const [state] = await db.select().from(userConceptStates)
    .where(and(
      eq(userConceptStates.userId, user.id),
      eq(userConceptStates.conceptId, conceptId),
    ));

  if (!state) return c.json({ mu: 0, sigma: 1.5, assessmentCount: 0 });
  return c.json(state);
});

// Get assessment history for a concept
masteryRoutes.get('/:conceptId/history', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const conceptId = c.req.param('conceptId');

  const events = await db.select().from(assessmentEvents)
    .where(and(
      eq(assessmentEvents.userId, user.id),
      eq(assessmentEvents.conceptId, conceptId),
    ))
    .orderBy(assessmentEvents.createdAt)
    .limit(50);

  return c.json(events);
});
