import { Hono } from 'hono';
import { desc } from 'drizzle-orm';
import { waitlistSignups, pressMentions, contactSubmissions } from '../db/schema.js';
import type { Env } from '../index.js';

export const publicRoutes = new Hono<Env>();

// POST /api/waitlist
publicRoutes.post('/waitlist', async (c) => {
  const body = await c.req.json();
  const email = body?.email?.trim()?.toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Valid email required' }, 400);
  }

  const db = c.get('db');
  try {
    await db.insert(waitlistSignups).values({
      id: crypto.randomUUID(),
      email,
      ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
    });
    return c.json({ ok: true });
  } catch (err: any) {
    const isUnique =
      err?.code === '23505' ||
      err?.cause?.code === '23505' ||
      err?.message?.includes('unique') ||
      err?.message?.includes('duplicate key') ||
      err?.cause?.message?.includes('unique') ||
      err?.cause?.message?.includes('duplicate key');
    if (isUnique) {
      return c.json({ error: 'Already signed up' }, 409);
    }
    throw err;
  }
});

// GET /api/press
publicRoutes.get('/press', async (c) => {
  const db = c.get('db');
  const rows = await db.select().from(pressMentions).orderBy(desc(pressMentions.createdAt));
  return c.json(rows);
});

// POST /api/contact
publicRoutes.post('/contact', async (c) => {
  const body = await c.req.json();
  const name = body?.name?.trim();
  const email = body?.email?.trim()?.toLowerCase();
  const message = body?.message?.trim();

  if (!name || !email || !message) {
    return c.json({ error: 'Name, email, and message are required' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Valid email required' }, 400);
  }

  const db = c.get('db');
  await db.insert(contactSubmissions).values({
    id: crypto.randomUUID(),
    name,
    email,
    message,
  });
  return c.json({ ok: true });
});
