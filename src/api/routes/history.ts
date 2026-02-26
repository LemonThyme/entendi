import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { assessmentEvents } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import type { Env } from '../index.js';

export const historyRoutes = new Hono<Env>();

historyRoutes.use('*', requireAuth);

// GET / — assessment event log for current user
historyRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const limit = parseInt(c.req.query('limit') || '50');

  const events = await db.select().from(assessmentEvents)
    .where(eq(assessmentEvents.userId, user.id))
    .orderBy(desc(assessmentEvents.createdAt))
    .limit(Math.min(limit, 200));

  return c.json(events);
});

// GET /:conceptId — per-concept history
historyRoutes.get('/:conceptId', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const conceptId = c.req.param('conceptId');

  const events = await db.select().from(assessmentEvents)
    .where(and(
      eq(assessmentEvents.userId, user.id),
      eq(assessmentEvents.conceptId, conceptId),
    ))
    .orderBy(desc(assessmentEvents.createdAt))
    .limit(50);

  return c.json(events);
});
