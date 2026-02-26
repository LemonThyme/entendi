import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { conceptRoutes } from './routes/concepts.js';
import { masteryRoutes } from './routes/mastery.js';
import { mcpRoutes } from './routes/mcp.js';
import { createDb, type Database } from './db/connection.js';
import { createAuth, type Auth } from './lib/auth.js';

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

  app.use('*', cors({
    origin: (origin) => origin || '*',
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
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('user', session?.user ?? null);
    c.set('session', session?.session ?? null);
    await next();
  });

  // Better Auth route handler
  app.on(['POST', 'GET'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
  });

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }));

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
