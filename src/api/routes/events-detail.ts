import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { assessmentEvents, concepts } from '../db/schema.js';
import type { Env } from '../index.js';
import { requireAuth } from '../middleware/auth.js';

export const eventDetailRoutes = new Hono<Env>();

eventDetailRoutes.use('*', requireAuth);

// GET /:eventId — full event detail for the authenticated user's own event
eventDetailRoutes.get('/:eventId', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const eventId = parseInt(c.req.param('eventId'), 10);
  if (Number.isNaN(eventId)) return c.json({ error: 'Invalid event ID' }, 400);

  const [event] = await db.select({
    id: assessmentEvents.id,
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
    .where(and(
      eq(assessmentEvents.id, eventId),
      eq(assessmentEvents.userId, user.id),
    ));

  if (!event) return c.json({ error: 'Event not found' }, 404);

  return c.json(event);
});
