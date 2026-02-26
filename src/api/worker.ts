/**
 * Cloudflare Workers entry point for the Entendi API.
 * Caches the Hono app per isolate to avoid recreating on every request.
 */
import { createApp } from './index.js';

interface WorkerEnv {
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

let cachedApp: ReturnType<typeof createApp> | null = null;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (!cachedApp) {
      cachedApp = createApp(env.DATABASE_URL, {
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
      });
    }
    return cachedApp.app.fetch(request);
  },
};
