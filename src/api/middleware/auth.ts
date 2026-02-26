import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

export async function requireAuth(c: Context<Env>, next: Next) {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
}
