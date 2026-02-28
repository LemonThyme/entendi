import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { emailPreferences } from '../db/schema.js';
import type { Env } from '../index.js';

export const preferencesRoutes = new Hono<Env>();

// GET /api/preferences — get current user's email preferences
preferencesRoutes.get('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const db = c.get('db');
  const rows = await db.select().from(emailPreferences).where(eq(emailPreferences.userId, user.id));

  if (rows.length === 0) {
    // Return defaults
    return c.json({
      summaryFrequency: 'weekly',
      transactionalEnabled: true,
    });
  }

  return c.json({
    summaryFrequency: rows[0].summaryFrequency,
    transactionalEnabled: rows[0].transactionalEnabled,
  });
});

// PUT /api/preferences — update email preferences (upsert)
preferencesRoutes.put('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json();
  const { summaryFrequency, transactionalEnabled } = body;

  // Validate summaryFrequency
  const validFrequencies = ['weekly', 'biweekly', 'monthly', 'off'];
  if (summaryFrequency !== undefined && !validFrequencies.includes(summaryFrequency)) {
    return c.json({ error: `summaryFrequency must be one of: ${validFrequencies.join(', ')}` }, 400);
  }

  const db = c.get('db');

  const values: Record<string, unknown> = {
    userId: user.id,
    updatedAt: new Date(),
  };
  if (summaryFrequency !== undefined) values.summaryFrequency = summaryFrequency;
  if (transactionalEnabled !== undefined) values.transactionalEnabled = transactionalEnabled;

  await db
    .insert(emailPreferences)
    .values({
      userId: user.id,
      summaryFrequency: summaryFrequency ?? 'weekly',
      transactionalEnabled: transactionalEnabled ?? true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: emailPreferences.userId,
      set: {
        ...(summaryFrequency !== undefined ? { summaryFrequency } : {}),
        ...(transactionalEnabled !== undefined ? { transactionalEnabled } : {}),
        updatedAt: new Date(),
      },
    });

  // Return the updated preferences
  const rows = await db.select().from(emailPreferences).where(eq(emailPreferences.userId, user.id));
  return c.json({
    summaryFrequency: rows[0].summaryFrequency,
    transactionalEnabled: rows[0].transactionalEnabled,
  });
});
