import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createDb, type Database } from './db/connection.js';
import { type Auth, createAuth } from './lib/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { analyticsRoutes } from './routes/analytics.js';
import { billingRoutes } from './routes/billing.js';
import { conceptRoutes } from './routes/concepts.js';
import { courseRoutes } from './routes/courses.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { deviceCodeRoutes } from './routes/device-code.js';
import { eventRoutes } from './routes/events.js';
import { eventDetailRoutes } from './routes/events-detail.js';
import { historyRoutes } from './routes/history.js';
import { masteryRoutes } from './routes/mastery.js';
import { mcpRoutes } from './routes/mcp.js';
import { orgRoutes } from './routes/org.js';
import { preferencesRoutes } from './routes/preferences.js';
import { publicRoutes } from './routes/public.js';

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

  // CORS — allow configured origins or sensible defaults
  const defaultOrigins = [
    'https://entendi.dev',
    'https://entendi-api.tomaskorenblit.workers.dev',
    'http://localhost:3456',
  ];
  const allowedOrigins = process.env.ENTENDI_CORS_ORIGINS
    ? process.env.ENTENDI_CORS_ORIGINS.split(',').map(s => s.trim())
    : defaultOrigins;
  app.use('*', cors({
    origin: (origin) => allowedOrigins.includes(origin) ? origin : '',
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
    // Support token query param for SSE (EventSource can't set headers)
    const tokenParam = new URL(c.req.url).searchParams.get('token');
    if (tokenParam && !c.req.header('Authorization')) {
      c.req.raw.headers.set('Authorization', `Bearer ${tokenParam}`);
    }

    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      c.set('user', session?.user ?? null);
      c.set('session', session?.session ?? null);
    } catch (err) {
      // Surface API key rate limit as 429 instead of silently falling through to 401
      if (err instanceof Error && err.message?.includes('rate limit')) {
        return c.json({ error: 'API key rate limit exceeded' }, 429);
      }
      c.set('user', null);
      c.set('session', null);
    }
    await next();
  });

  // Rate limit API routes (200 requests/minute per user/IP)
  app.use('/api/*', rateLimit({ windowMs: 60_000, max: 200 }));

  // Device code routes (before Better Auth catch-all to prevent interception)
  app.route('/api/auth/device-code', deviceCodeRoutes);

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
  app.route('/api/courses', courseRoutes);
  app.route('/api/billing', billingRoutes);
  app.route('/api/preferences', preferencesRoutes);
  app.route('/api/events', eventRoutes);
  app.route('/api/events', eventDetailRoutes);
  app.route('/api/analytics', analyticsRoutes);
  app.route('/api', publicRoutes);

  // Cache static assets with immutable headers
  app.get('/assets/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });

  // Dashboard at root (must be after /api/* and /health routes)
  app.route('/', dashboardRoutes);

  // Redirect legacy /dashboard to /
  app.get('/dashboard', (c) => c.redirect('/'));
  app.get('/dashboard/*', (c) => {
    const path = c.req.path.replace('/dashboard', '');
    return c.redirect(path || '/');
  });

  // 404 handler
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

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
