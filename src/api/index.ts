import { and, eq, isNull, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createDb, type Database } from './db/connection.js';
import { pendingActions, probeTokens } from './db/schema.js';
import { type Auth, createAuth } from './lib/auth.js';
import { logger } from './lib/logger.js';
import { rateLimit } from './middleware/rate-limit.js';
import { requestLogger } from './middleware/request-logger.js';
import { adminStatsRoutes } from './routes/admin-stats.js';
import { analyticsRoutes } from './routes/analytics.js';
import { billingRoutes } from './routes/billing.js';
import { conceptRoutes } from './routes/concepts.js';
import { courseRoutes } from './routes/courses.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { deviceCodeRoutes } from './routes/device-code.js';
import { eventRoutes } from './routes/events.js';
import { eventDetailRoutes } from './routes/events-detail.js';
import { historyRoutes } from './routes/history.js';
import { hookRoutes } from './routes/hooks.js';
import { masteryRoutes } from './routes/mastery.js';
import { mcpRoutes } from './routes/mcp.js';
import { openapiRoutes } from './routes/openapi.js';
import { orgRoutes } from './routes/org.js';
import { preferencesRoutes } from './routes/preferences.js';
import { publicRoutes } from './routes/public.js';
import { type PageMeta, publicShell } from './routes/public-html.js';

export type Env = {
  Variables: {
    db: Database;
    auth: Auth;
    user: { id: string; name: string; email: string; role?: string | null; banned?: boolean | null; onboardingCompletedAt?: Date | null } | null;
    session: { id: string; userId: string; activeOrganizationId?: string | null } | null;
    requestId: string;
  };
};

function getApiStatusPage(): string {
  return publicShell('Entendi API', 'status', `
    <style>
      .status-header { margin: 3rem 0 2rem; }
      .status-header h1 { font-family: var(--font-display); font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; }
      .status-header p { color: var(--text-secondary); margin-top: 0.25rem; font-size: 0.875rem; }
      .status-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.5rem; }
      .status-row { display: flex; justify-content: space-between; align-items: center; padding: 0.625rem 0; }
      .status-row + .status-row { border-top: 1px solid var(--border); }
      .status-label { color: var(--text-secondary); font-size: 0.8125rem; }
      .badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 99px; font-size: 0.75rem; font-weight: 500; }
      .badge-ok { background: #E8F5E9; color: var(--green); }
      .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .badge-err { background: #FBE9E7; color: var(--red); }
      .badge-loading { background: var(--bg-card); color: var(--text-tertiary); }
      .latency { color: var(--text-tertiary); font-size: 0.75rem; }
      .status-links { margin-top: 1.5rem; display: flex; gap: 1.25rem; }
      .status-links a { color: var(--text-secondary); font-size: 0.8125rem; text-decoration: none; }
      .status-links a:hover { color: var(--text); }
    </style>
    <div class="status-header">
      <h1>API Status</h1>
      <p>api.entendi.dev</p>
    </div>
    <div class="status-card">
      <div class="status-row">
        <span class="status-label">API</span>
        <span id="api-status" class="badge badge-loading">checking\u2026</span>
      </div>
      <div class="status-row">
        <span class="status-label">Database</span>
        <span id="db-status" class="badge badge-loading">checking\u2026</span>
      </div>
      <div class="status-row">
        <span class="status-label">Latency</span>
        <span id="latency" class="latency">-</span>
      </div>
    </div>
    <div class="status-links">
      <a href="/api/openapi.json">OpenAPI</a>
      <a href="/health">Health JSON</a>
    </div>
    <script>
      function setBadge(id, ok, label) {
        var el = document.getElementById(id);
        el.textContent = label;
        el.className = 'badge ' + (ok ? 'badge-ok' : 'badge-err');
        var dot = document.createElement('span');
        dot.className = 'badge-dot';
        el.prepend(dot);
      }
      (async function() {
        var start = Date.now();
        try {
          var res = await fetch('/health');
          var ms = Date.now() - start;
          var data = await res.json();
          setBadge('api-status', data.status === 'ok', data.status === 'ok' ? 'Operational' : 'Degraded');
          setBadge('db-status', data.db === 'connected', data.db === 'connected' ? 'Connected' : 'Unreachable');
          document.getElementById('latency').textContent = ms + 'ms';
        } catch(e) {
          setBadge('api-status', false, 'Unreachable');
          setBadge('db-status', false, 'Unknown');
          document.getElementById('latency').textContent = '-';
        }
      })();
    </script>
  `, {
    description: 'Live status of the Entendi API.',
    ogTitle: 'API Status | Entendi',
    ogUrl: 'https://api.entendi.dev',
    ogType: 'website',
    twitterCard: 'summary',
  });
}

export function createApp(databaseUrl: string, authOptions?: { secret?: string; baseURL?: string }) {
  const app = new Hono<Env>();
  const db = createDb(databaseUrl);
  const auth = createAuth(db, authOptions);
  const startedAt = Date.now();

  // Global error handler with structured logging
  app.onError((err, c) => {
    const status = 'status' in err && typeof err.status === 'number' ? err.status : 500;
    const requestId = c.get('requestId');

    if (status >= 500) {
      logger.error('request.error', {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status,
        message: err.message,
        stack: err.stack,
        userId: c.get('user')?.id,
      });
    } else if (status >= 400) {
      logger.warn('request.client_error', {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status,
        message: err.message,
        userId: c.get('user')?.id,
      });
    }

    return c.json(
      { error: status >= 500 ? 'Internal server error' : err.message, requestId },
      status as any,
    );
  });

  // CORS — allow configured origins or sensible defaults
  const defaultOrigins = [
    'https://entendi.dev',
    'https://api.entendi.dev',
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

  // Request ID and structured request logging
  app.use('*', requestLogger);

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
        logger.warn('auth.api_key_rate_limit', {
          requestId: c.get('requestId'),
          ip: c.req.header('cf-connecting-ip'),
          path: c.req.path,
        });
        return c.json({ error: 'API key rate limit exceeded' }, 429);
      }
      logger.debug('auth.session_resolution_failed', {
        requestId: c.get('requestId'),
        path: c.req.path,
        error: err instanceof Error ? err.message : String(err),
      });
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

  // Health check with DB connectivity and diagnostics
  let lastCleanupTime = 0;
  const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

  app.get('/health', async (c) => {
    const uptimeMs = Date.now() - startedAt;
    const environment = process.env.ENVIRONMENT || 'production';
    try {
      const { sql } = await import('drizzle-orm');
      const dbStart = Date.now();
      await db.execute(sql`SELECT 1`);
      const dbLatencyMs = Date.now() - dbStart;

      // Periodic orphan cleanup (fire and forget)
      if (Date.now() - lastCleanupTime > CLEANUP_INTERVAL) {
        lastCleanupTime = Date.now();
        Promise.all([
          db.delete(probeTokens).where(
            and(isNull(probeTokens.usedAt), lt(probeTokens.expiresAt, new Date()))
          ),
          db.delete(pendingActions).where(
            and(
              eq(pendingActions.actionType, 'awaiting_probe_response'),
              lt(pendingActions.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
            )
          ),
        ]).catch(() => { /* non-critical cleanup */ });
      }

      return c.json({
        status: 'ok',
        db: 'connected',
        dbLatencyMs,
        uptimeMs,
        environment,
      });
    } catch (err) {
      return c.json({
        status: 'degraded',
        db: 'unreachable',
        error: String(err),
        uptimeMs,
        environment,
      }, 503);
    }
  });

  // Current user
  app.get('/api/me', async (c) => {
    const currentUser = c.get('user');
    if (!currentUser) return c.json({ error: 'Unauthorized' }, 401);
    const { eq } = await import('drizzle-orm');
    const { apikey, user: userTable } = await import('./db/schema.js');
    const [keys, userRow] = await Promise.all([
      db.select({ id: apikey.id }).from(apikey).where(eq(apikey.userId, currentUser.id)).limit(1),
      db.select({ onboardingCompletedAt: userTable.onboardingCompletedAt }).from(userTable).where(eq(userTable.id, currentUser.id)).limit(1),
    ]);
    return c.json({
      user: { ...currentUser, onboardingCompletedAt: userRow[0]?.onboardingCompletedAt ?? null },
      hasApiKey: keys.length > 0,
    });
  });

  // Mark onboarding complete
  app.post('/api/me/onboarding-complete', async (c) => {
    const currentUser = c.get('user');
    if (!currentUser) return c.json({ error: 'Unauthorized' }, 401);
    const { eq } = await import('drizzle-orm');
    const { user: userTable } = await import('./db/schema.js');
    await db.update(userTable).set({ onboardingCompletedAt: new Date() }).where(eq(userTable.id, currentUser.id));
    return c.json({ ok: true });
  });

  // Delete current user and all associated data (right-to-deletion)
  app.delete('/api/me', async (c) => {
    const currentUser = c.get('user');
    if (!currentUser) return c.json({ error: 'Unauthorized' }, 401);

    const { eq } = await import('drizzle-orm');
    const { eventAnnotations, user: userTable } = await import('./db/schema.js');

    // Delete event annotations first (no cascade on authorId FK)
    await db.delete(eventAnnotations).where(eq(eventAnnotations.authorId, currentUser.id));
    // Delete user row — all other tables cascade
    await db.delete(userTable).where(eq(userTable.id, currentUser.id));

    return c.json({ ok: true });
  });

  // Routes
  app.route('/api/admin', adminStatsRoutes);
  app.route('/api/concepts', conceptRoutes);
  app.route('/api/mastery', masteryRoutes);
  app.route('/api/mcp', mcpRoutes);
  app.route('/api/history', historyRoutes);
  app.route('/api/hooks', hookRoutes);
  app.route('/api/org', orgRoutes);
  app.route('/api/courses', courseRoutes);
  app.route('/api/billing', billingRoutes);
  app.route('/api/preferences', preferencesRoutes);
  app.route('/api/events', eventRoutes);
  app.route('/api/events', eventDetailRoutes);
  app.route('/api/analytics', analyticsRoutes);
  app.route('/api', openapiRoutes);
  app.route('/api', publicRoutes);

  // Cache static assets with immutable headers
  app.get('/assets/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });

  // API subdomain status page — show status instead of dashboard/landing
  app.use('*', async (c, next) => {
    const host = c.req.header('host') || '';
    if (!host.startsWith('api.')) return next();
    // Let API routes, health, auth pages, and assets pass through
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/') || path === '/health' || path === '/link' || path.startsWith('/assets/')) {
      return next();
    }
    // Serve status page for everything else on the api subdomain
    return c.html(getApiStatusPage());
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
