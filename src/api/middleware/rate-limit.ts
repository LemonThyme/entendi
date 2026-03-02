import type { Context, Next } from 'hono';
import type { Env } from '../index.js';
import { logger } from '../lib/logger.js';

/**
 * Simple in-memory sliding-window rate limiter.
 * Suitable for single-instance deployments and Cloudflare Workers (per-isolate).
 * For multi-instance, replace with a shared store (e.g., Durable Objects or Redis).
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

/** Reset rate limit store (for testing) */
export function resetRateLimitStore() {
  store.clear();
}

// Cleanup stale entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

export function rateLimit(options: {
  windowMs: number;
  max: number;
  keyFn?: (c: Context<Env>) => string;
}) {
  const { windowMs, max, keyFn } = options;

  return async (c: Context<Env>, next: Next) => {
    cleanup(windowMs);

    const key = keyFn
      ? keyFn(c)
      : c.get('user')?.id ?? c.req.header('x-forwarded-for') ?? 'anonymous';

    const now = Date.now();
    const cutoff = now - windowMs;
    let entry = store.get(key);

    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Remove expired timestamps
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);

    if (entry.timestamps.length >= max) {
      const retryAfter = Math.ceil((entry.timestamps[0] + windowMs - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Limit', String(max));
      c.header('X-RateLimit-Remaining', '0');
      logger.warn('security.rate_limit_hit', {
        key,
        path: c.req.path,
        method: c.req.method,
        requestId: c.get('requestId'),
      });
      return c.json({ error: 'Too many requests' }, 429);
    }

    entry.timestamps.push(now);

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(max - entry.timestamps.length));

    await next();
  };
}
