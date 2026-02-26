import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq, gt, sql } from 'drizzle-orm';
import { assessmentEvents, member } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { pMastery } from '../../schemas/types.js';
import type { Env } from '../index.js';

export const eventRoutes = new Hono<Env>();

eventRoutes.use('*', requireAuth);

eventRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  // Find user's org members for scoping
  const memberships = await db.select({ organizationId: member.organizationId })
    .from(member).where(eq(member.userId, user.id)).limit(1);

  let orgMemberIds: string[] = [user.id];
  if (memberships.length > 0) {
    const orgMembers = await db.select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, memberships[0].organizationId));
    orgMemberIds = orgMembers.map(m => m.userId);
  }

  // Get Last-Event-ID for incremental updates
  const lastEventId = parseInt(c.req.header('Last-Event-ID') || '0') || 0;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'connected', data: JSON.stringify({ retry: 3000 }) });

    let currentLastId = lastEventId;
    const maxIterations = 8; // ~24s of connection (3s per iteration)

    for (let i = 0; i < maxIterations; i++) {
      const newEvents = await db.select().from(assessmentEvents)
        .where(
          currentLastId > 0
            ? sql`${assessmentEvents.id} > ${currentLastId} AND ${assessmentEvents.userId} = ANY(${orgMemberIds})`
            : sql`${assessmentEvents.userId} = ANY(${orgMemberIds})`,
        )
        .orderBy(assessmentEvents.id)
        .limit(20);

      for (const event of newEvents) {
        await stream.writeSSE({
          event: 'mastery_update',
          data: JSON.stringify({
            userId: event.userId,
            conceptId: event.conceptId,
            eventType: event.eventType,
            score: event.rubricScore,
            masteryBefore: Math.round(pMastery(event.muBefore) * 100),
            masteryAfter: Math.round(pMastery(event.muAfter) * 100),
            createdAt: event.createdAt,
          }),
          id: String(event.id),
        });
        currentLastId = event.id;
      }

      await stream.writeSSE({ event: 'heartbeat', data: '' });

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  });
});
