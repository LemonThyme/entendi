/**
 * Cloudflare Workers entry point for the Entendi API.
 * Caches the Hono app per isolate to avoid recreating on every request.
 */
import { createApp } from './index.js';

/** Minimal R2 bucket interface (avoids @cloudflare/workers-types dependency) */
interface R2BucketLike {
  put(key: string, value: string | ReadableStream | ArrayBuffer, options?: Record<string, unknown>): Promise<unknown>;
}

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
  R2_BUCKET?: R2BucketLike;
}

let cachedApp: ReturnType<typeof createApp> | null = null;

function propagateEnv(env: WorkerEnv): void {
  process.env.BETTER_AUTH_SECRET = env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_URL = env.BETTER_AUTH_URL;
  if (env.GITHUB_CLIENT_ID) process.env.GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID;
  if (env.GITHUB_CLIENT_SECRET) process.env.GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;
  if (env.GOOGLE_CLIENT_ID) process.env.GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
  if (env.GOOGLE_CLIENT_SECRET) process.env.GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
  if (env.RESEND_API_KEY) process.env.RESEND_API_KEY = env.RESEND_API_KEY;
  if (env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY;
  if (env.STRIPE_WEBHOOK_SECRET) process.env.STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;
}

const BACKUP_TABLES = [
  'concepts',
  'user_concept_states',
  'assessment_events',
  'tutor_sessions',
] as const;

async function runBackup(db: import('./db/connection.js').Database, bucket: R2BucketLike): Promise<{ tables: number; totalRows: number }> {
  const { sql } = await import('drizzle-orm');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let totalRows = 0;

  for (const table of BACKUP_TABLES) {
    const rows = await db.execute(sql.raw(`SELECT row_to_json(t) FROM ${table} t`));
    const jsonLines = (rows.rows as Array<{ row_to_json: unknown }>)
      .map(r => JSON.stringify(r.row_to_json))
      .join('\n');
    totalRows += rows.rows.length;

    await bucket.put(
      `backups/${timestamp}/${table}.jsonl`,
      jsonLines || '',
      { httpMetadata: { contentType: 'application/x-ndjson' } },
    );
  }

  return { tables: BACKUP_TABLES.length, totalRows };
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

  async scheduled(_event: unknown, env: WorkerEnv, _ctx: unknown): Promise<void> {
    process.env.DATABASE_URL = env.DATABASE_URL;
    if (env.RESEND_API_KEY) process.env.RESEND_API_KEY = env.RESEND_API_KEY;
    const { createDb } = await import('./db/connection.js');
    const { runMasterySummaryJob } = await import('./jobs/mastery-summary.js');
    const db = createDb(env.DATABASE_URL);

    // Mastery summary emails
    const result = await runMasterySummaryJob(db);
    console.log(`[Entendi] Mastery summary job: sent=${result.sent} skipped=${result.skipped}`);

    // Database backup to R2
    if (!env.R2_BUCKET) {
      console.log('[Entendi] Backup skipped: R2_BUCKET binding not configured');
      return;
    }
    try {
      const backup = await runBackup(db, env.R2_BUCKET);
      console.log(`[Entendi] Backup complete: ${backup.tables} tables, ${backup.totalRows} rows`);
    } catch (err) {
      console.error(`[Entendi] Backup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
