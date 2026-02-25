import { serve } from '@hono/node-server';
import { createDashboardApp } from './server.js';

const port = parseInt(process.env.PORT ?? '3737', 10);
const projectDir = process.env.ENTENDI_PROJECT_DIR ?? process.cwd();

const app = createDashboardApp(projectDir);
console.log(`Entendi Dashboard running at http://localhost:${port}`);
console.log(`Reading data from: ${projectDir}/.entendi/`);
serve({ fetch: app.fetch, port });
