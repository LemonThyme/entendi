import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { conceptRoutes } from './routes/concepts.js';
import { masteryRoutes } from './routes/mastery.js';
import { mcpRoutes } from './routes/mcp.js';
import { historyRoutes } from './routes/history.js';
import { orgRoutes } from './routes/org.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { createDb, type Database } from './db/connection.js';
import { createAuth, type Auth } from './lib/auth.js';
import { rateLimit } from './middleware/rate-limit.js';

export type Env = {
  Variables: {
    db: Database;
    auth: Auth;
    user: { id: string; name: string; email: string } | null;
    session: { id: string; userId: string; activeOrganizationId?: string | null } | null;
  };
};

export function createApp(databaseUrl: string, authOptions?: { secret?: string; baseURL?: string }) {
  const app = new Hono<Env>();
  const db = createDb(databaseUrl);
  const auth = createAuth(db, authOptions);

  // Global error handler
  app.onError((err, c) => {
    const status = 'status' in err && typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) {
      console.error(`[Entendi] ${c.req.method} ${c.req.path} — ${err.message}`);
    }
    return c.json(
      { error: status >= 500 ? 'Internal server error' : err.message },
      status as any,
    );
  });

  // CORS — allow configured origins or fall back to permissive
  const allowedOrigins = process.env.ENTENDI_CORS_ORIGINS?.split(',').map(s => s.trim());
  app.use('*', cors({
    origin: allowedOrigins
      ? (origin) => allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
      : (origin) => origin || '*',
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  }));

  // Inject db and auth into context
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('auth', auth);
    await next();
  });

  // Session middleware — resolves user from cookie, bearer token, or API key
  app.use('*', async (c, next) => {
    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      c.set('user', session?.user ?? null);
      c.set('session', session?.session ?? null);
    } catch {
      // Session resolution failed (e.g., rate-limited API key) — continue unauthenticated
      c.set('user', null);
      c.set('session', null);
    }
    await next();
  });

  // Rate limit API routes (200 requests/minute per user/IP)
  app.use('/api/*', rateLimit({ windowMs: 60_000, max: 200 }));

  // Better Auth route handler
  app.on(['POST', 'GET'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
  });

  // Health check with DB connectivity
  app.get('/health', async (c) => {
    try {
      const { sql } = await import('drizzle-orm');
      await db.execute(sql`SELECT 1`);
      return c.json({ status: 'ok', db: 'connected' });
    } catch (err) {
      return c.json({ status: 'degraded', db: 'unreachable', error: String(err) }, 503);
    }
  });

  // Current user
  app.get('/api/me', (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({ user });
  });

  // Routes
  app.route('/api/concepts', conceptRoutes);
  app.route('/api/mastery', masteryRoutes);
  app.route('/api/mcp', mcpRoutes);
  app.route('/api/history', historyRoutes);
  app.route('/api/org', orgRoutes);
  app.route('/dashboard', dashboardRoutes);

  return { app, auth, db };
}

// Dev server
async function main() {
  const { config } = await import('dotenv');
  config();
  const { serve } = await import('@hono/node-server');
  const { app } = createApp(process.env.DATABASE_URL!);
  serve({ fetch: app.fetch, port: 3456 }, (info) => {
    console.log(`Entendi API running at http://localhost:${info.port}`);
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch(console.error);
}
