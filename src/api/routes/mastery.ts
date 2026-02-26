import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { userConceptStates, assessmentEvents } from '../db/schema.js';
import type { Env } from '../index.js';

export const masteryRoutes = new Hono<Env>();

// Get all mastery states for a user
masteryRoutes.get('/', async (c) => {
  const db = c.get('db');
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const states = await db.select().from(userConceptStates)
    .where(eq(userConceptStates.userId, userId));
  return c.json(states);
});

// Get mastery for a specific concept
masteryRoutes.get('/:conceptId', async (c) => {
  const db = c.get('db');
  const userId = c.req.query('userId');
  const conceptId = c.req.param('conceptId');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const [state] = await db.select().from(userConceptStates)
    .where(and(
      eq(userConceptStates.userId, userId),
      eq(userConceptStates.conceptId, conceptId),
    ));

  if (!state) return c.json({ mu: 0, sigma: 1.5, assessmentCount: 0 });
  return c.json(state);
});

// Get assessment history for a concept
masteryRoutes.get('/:conceptId/history', async (c) => {
  const db = c.get('db');
  const userId = c.req.query('userId');
  const conceptId = c.req.param('conceptId');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const events = await db.select().from(assessmentEvents)
    .where(and(
      eq(assessmentEvents.userId, userId),
      eq(assessmentEvents.conceptId, conceptId),
    ))
    .orderBy(assessmentEvents.createdAt)
    .limit(50);

  return c.json(events);
});
