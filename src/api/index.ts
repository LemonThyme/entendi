import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { conceptRoutes } from './routes/concepts.js';
import { masteryRoutes } from './routes/mastery.js';
import { createDb, type Database } from './db/connection.js';

export type Env = {
  Variables: {
    db: Database;
  };
};

export function createApp(databaseUrl: string) {
  const app = new Hono<Env>();
  const db = createDb(databaseUrl);

  app.use('*', cors());
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.route('/api/concepts', conceptRoutes);
  app.route('/api/mastery', masteryRoutes);

  return app;
}

// Dev server
async function main() {
  const { config } = await import('dotenv');
  config();
  const { serve } = await import('@hono/node-server');
  const app = createApp(process.env.DATABASE_URL!);
  serve({ fetch: app.fetch, port: 3456 }, (info) => {
    console.log(`Entendi API running at http://localhost:${info.port}`);
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch(console.error);
}
