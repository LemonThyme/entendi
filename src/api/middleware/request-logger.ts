import type { Context, Next } from 'hono';
import type { Env } from '../index.js';
import { logger } from '../lib/logger.js';

export async function requestLogger(c: Context<Env>, next: Next) {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);

  const start = Date.now();

  await next();

  const path = c.req.path;
  if (path === '/health' || path.startsWith('/assets/')) return;

  logger.info('request.complete', {
    requestId,
    method: c.req.method,
    path,
    status: c.res.status,
    durationMs: Date.now() - start,
    userId: c.get('user')?.id,
    ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for'),
    userAgent: c.req.header('user-agent'),
  });
}
