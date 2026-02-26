import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { deviceCodes } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import type { Env } from '../index.js';

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
// Charset without ambiguous characters (0/O, 1/I/l)
const CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

export const deviceCodeRoutes = new Hono<Env>();

// POST / — create a new device code (no auth required)
deviceCodeRoutes.post('/', async (c) => {
  const db = c.get('db');
  const code = generateCode();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_MS);
  const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3456';
  const verifyUrl = `${baseUrl}/dashboard/link?code=${code}`;

  await db.insert(deviceCodes).values({
    code,
    status: 'pending',
    expiresAt,
  });

  return c.json({ code, verifyUrl, expiresAt: expiresAt.toISOString() });
});

// GET /:code — poll device code status (no auth required)
deviceCodeRoutes.get('/:code', async (c) => {
  const db = c.get('db');
  const code = c.req.param('code');

  const rows = await db.select().from(deviceCodes).where(eq(deviceCodes.code, code));
  if (rows.length === 0) {
    return c.json({ error: 'Device code not found' }, 404);
  }

  const row = rows[0];

  // Check expiry
  if (row.status === 'pending' && new Date(row.expiresAt) < new Date()) {
    // Clean up expired code
    await db.delete(deviceCodes).where(eq(deviceCodes.code, code));
    return c.json({ status: 'expired' });
  }

  if (row.status === 'confirmed' && row.apiKey) {
    // Return key and delete the row (single-use)
    await db.delete(deviceCodes).where(eq(deviceCodes.code, code));
    return c.json({ status: 'confirmed', apiKey: row.apiKey });
  }

  return c.json({ status: row.status });
});

// POST /:code/confirm — confirm a device code (auth required)
deviceCodeRoutes.post('/:code/confirm', requireAuth, async (c) => {
  const db = c.get('db');
  const auth = c.get('auth');
  const user = c.get('user');
  const code = c.req.param('code');

  const rows = await db.select().from(deviceCodes).where(eq(deviceCodes.code, code));
  if (rows.length === 0) {
    return c.json({ error: 'Device code not found' }, 404);
  }

  const row = rows[0];

  if (row.status !== 'pending') {
    return c.json({ error: 'Device code already used or expired' }, 400);
  }

  if (new Date(row.expiresAt) < new Date()) {
    await db.delete(deviceCodes).where(eq(deviceCodes.code, code));
    return c.json({ error: 'Device code expired' }, 400);
  }

  // Generate API key for the user (rate limit disabled globally in auth config)
  const keyResult = await auth.api.createApiKey({
    body: {
      name: `device-${code}`,
    },
    headers: c.req.raw.headers,
  });

  const apiKey = keyResult?.key;
  if (!apiKey) {
    return c.json({ error: 'Failed to create API key' }, 500);
  }

  // Update device code with user and key
  await db.update(deviceCodes)
    .set({
      userId: user!.id,
      apiKey,
      status: 'confirmed',
    })
    .where(eq(deviceCodes.code, code));

  return c.json({ status: 'confirmed' });
});
