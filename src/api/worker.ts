/**
 * Cloudflare Workers entry point for the Entendi API.
 * Caches the Hono app per isolate to avoid recreating on every request.
 */
import { createApp } from './index.js';

interface WorkerEnv {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

let cachedApp: ReturnType<typeof createApp> | null = null;

function propagateEnv(env: WorkerEnv): void {
  if (env.GITHUB_CLIENT_ID) process.env.GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID;
  if (env.GITHUB_CLIENT_SECRET) process.env.GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;
  if (env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
  if (env.GOOGLE_CLIENT_SECRET) process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
  if (env.RESEND_API_KEY) process.env.RESEND_API_KEY = env.RESEND_API_KEY;
  if (env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
  if (env.STRIPE_WEBHOOK_SECRET) process.env.STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (!cachedApp) {
      propagateEnv(env);
      cachedApp = createApp(env.DATABASE_URL, {
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
      });
    }
    return cachedApp.app.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: WorkerEnv, _ctx: ExecutionContext): Promise<void> {
    process.env.DATABASE_URL = env.DATABASE_URL;
    if (env.RESEND_API_KEY) process.env.RESEND_API_KEY = env.RESEND_API_KEY;
    const { createDb } = await import('./db/connection.js');
    const { runMasterySummaryJob } = await import('./jobs/mastery-summary.js');
    const db = createDb(env.DATABASE_URL);
    const result = await runMasterySummaryJob(db);
    console.log(`[Entendi] Mastery summary job: sent=${result.sent} skipped=${result.skipped}`);
  },
};
