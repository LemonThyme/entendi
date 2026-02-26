# Dashboard Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Optimize the dashboard with static asset extraction, minification, caching, and real-time SSE updates for live mastery changes.

**Architecture:** Extract CSS/JS from the 80KB monolithic template into separate files, minify with esbuild, serve via Cloudflare Workers Static Assets with content-hash filenames. Add an SSE endpoint that streams org-scoped mastery updates to connected dashboards.

**Tech Stack:** esbuild (minify + hash), Cloudflare Workers Static Assets, SSE (Server-Sent Events), Hono streaming

---

### Task 1: Extract CSS into standalone file

**Files:**
- Create: `src/dashboard/dashboard.css`
- Modify: `src/api/routes/dashboard.ts`

**Step 1: Create `src/dashboard/dashboard.css`**

Copy the entire content between `<style>` and `</style>` (lines 32–389 of `dashboard.ts`) into `src/dashboard/dashboard.css`. This is the CSS block starting with `:root {` and ending with the `@media` query closing brace. Keep it as-is, no modifications.

**Step 2: Remove inline CSS from dashboard.ts**

In `getDashboardHTML()`, replace the `<style>...</style>` block with a `<link>` tag placeholder. The exact href will be set by the manifest system (Task 3), but for now use:

```html
<link rel="stylesheet" href="__CSS_HREF__"/>
```

Keep the Google Fonts `<link>` tags and favicon — those stay in the HTML.

**Step 3: Verify the file splits cleanly**

Run: `wc -l src/dashboard/dashboard.css`
Expected: ~358 lines

---

### Task 2: Extract JS into standalone files

**Files:**
- Create: `src/dashboard/dashboard.js`
- Create: `src/dashboard/link.js`
- Modify: `src/api/routes/dashboard.ts`

**Step 1: Create `src/dashboard/dashboard.js`**

Copy the entire content between `<script>` and `</script>` tags in `getDashboardHTML()` (lines 464–1596) into `src/dashboard/dashboard.js`. This is the IIFE starting with `(function() {` and ending with `})();`. Keep it exactly as-is. Note: the template literal escape sequences (`\\u2014`, `\\u2022`) must be converted to actual JS escape sequences (`\u2014`, `\u2022`).

**Step 2: Create `src/dashboard/link.js`**

Copy the script from `getDeviceLinkHTML()` (lines 1668–1824) into `src/dashboard/link.js`. Same approach — the IIFE content. The `code` variable is set from the HTML via a global: replace `var code = ${JSON.stringify(safeCode)};` with `var code = document.getElementById("device-code").getAttribute("data-code");` and add `data-code` attribute to the HTML element instead.

**Step 3: Update dashboard.ts template strings**

Replace the `<script>...</script>` blocks in both `getDashboardHTML()` and `getDeviceLinkHTML()` with `<script>` tag placeholders:

```html
<script src="__JS_HREF__"></script>
```

For the link page, set the code via data attribute on the code display element:
```typescript
<div class="code-display" id="device-code" data-code="${safeCode}"></div>
```

**Step 4: Verify files**

Run: `wc -l src/dashboard/dashboard.js src/dashboard/link.js`
Expected: ~1130 lines for dashboard.js, ~160 lines for link.js

---

### Task 3: Add esbuild pipeline for dashboard assets

**Files:**
- Modify: `esbuild.config.ts`
- Create: `public/.gitkeep` (directory for build output)

**Step 1: Create public directory**

```bash
mkdir -p public/assets
```

**Step 2: Add dashboard build step to esbuild.config.ts**

Add after the existing MCP build step. This step:
1. Bundles `src/dashboard/dashboard.js` and `src/dashboard/dashboard.css` with minification
2. Outputs to `public/assets/` with content-hash filenames
3. Writes a manifest JSON mapping source names to hashed output names

```typescript
import { writeFileSync, mkdirSync } from 'fs';

// --- Dashboard asset build ---
mkdirSync('public/assets', { recursive: true });

const dashboardBuild = await esbuild.build({
  entryPoints: [
    join('src', 'dashboard', 'dashboard.js'),
    join('src', 'dashboard', 'dashboard.css'),
    join('src', 'dashboard', 'link.js'),
  ],
  bundle: false,
  minify: true,
  outdir: join('public', 'assets'),
  entryNames: '[name]-[hash]',
  metafile: true,
});

// Generate asset manifest from metafile
const manifest: Record<string, string> = {};
for (const [outPath, meta] of Object.entries(dashboardBuild.metafile!.outputs)) {
  if (meta.entryPoint) {
    const name = meta.entryPoint.replace('src/dashboard/', '');
    const hashed = outPath.replace('public/', '/');
    manifest[name] = hashed;
  }
}
writeFileSync(join('public', 'assets', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Dashboard asset manifest:', manifest);
```

**Step 3: Run the build**

Run: `node --import tsx esbuild.config.ts`
Expected: Console output showing manifest with hashed filenames like `{ "dashboard.js": "/assets/dashboard-XXXX.js", ... }`

**Step 4: Add public/assets to .gitignore**

Add `public/assets/` to `.gitignore` (these are build artifacts, not source).

---

### Task 4: Update dashboard.ts to use manifest + caching

**Files:**
- Modify: `src/api/routes/dashboard.ts`

**Step 1: Rewrite dashboard.ts**

The file should:
1. Read the manifest at module load (or receive it as a param)
2. Replace `__CSS_HREF__` and `__JS_HREF__` with actual hashed paths from manifest
3. Add `Cache-Control` and `ETag` headers
4. Support `If-None-Match` for 304 responses

The result: `dashboard.ts` becomes ~80 lines instead of 1828.

```typescript
import { Hono } from 'hono';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { Env } from '../index.js';

export const dashboardRoutes = new Hono<Env>();

// Load asset manifest (built by esbuild.config.ts)
let manifest: Record<string, string> = {};
const manifestPath = join(process.cwd(), 'public', 'assets', 'manifest.json');
try {
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  }
} catch { /* fallback to empty manifest in dev */ }

const manifestHash = createHash('md5')
  .update(JSON.stringify(manifest))
  .digest('hex')
  .slice(0, 12);

function getShellHTML(): string {
  const cssHref = manifest['dashboard.css'] || '/assets/dashboard.css';
  const jsHref = manifest['dashboard.js'] || '/assets/dashboard.js';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Entendi</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,..."/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="${cssHref}"/>
</head>
<body>
  <!-- same HTML body structure as current getDashboardHTML -->
  <template id="tpl-github-btn">...</template>
  <template id="tpl-google-btn">...</template>
  <script src="${jsHref}"></script>
</body>
</html>`;
}

dashboardRoutes.get('/', (c) => {
  const etag = `"${manifestHash}"`;
  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304);
  }
  c.header('Cache-Control', 'public, max-age=300');
  c.header('ETag', etag);
  return c.html(getShellHTML());
});

dashboardRoutes.get('/link', (c) => {
  const code = c.req.query('code') || '';
  const safeCode = code.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  const linkJsHref = manifest['link.js'] || '/assets/link.js';
  c.header('Cache-Control', 'public, max-age=300');
  return c.html(getLinkShellHTML(safeCode, linkJsHref));
});
```

**Important:** The HTML body structure (everything between `<body>` and `</body>` except `<style>` and `<script>`) stays exactly the same. Copy the body content (templates, container div, auth-area, content div, tabs, etc.) from the current file. Only the CSS/JS references change.

**Step 2: Verify locally**

Run: `npm run build && npm run api:dev`
Visit: `http://localhost:3456`
Expected: Dashboard loads with separate CSS/JS files, no inline styles/scripts.

---

### Task 5: Configure Cloudflare Workers Static Assets

**Files:**
- Modify: `wrangler.toml`

**Step 1: Add static assets config**

```toml
[assets]
directory = "public"
run_worker_first = ["/api/*", "/health", "/", "/link"]
not_found_handling = "none"
```

This tells Cloudflare to serve files from `public/` directory at the edge. Static assets (`/assets/dashboard-abc123.js`) are served directly from the CDN without invoking the Worker. Routes matching `/api/*`, `/health`, `/`, and `/link` still go through the Worker.

**Step 2: Add cache headers for static assets in Worker**

In `src/api/index.ts`, add middleware for `/assets/*` requests that sets immutable caching (in case the Worker handles them in dev):

```typescript
app.get('/assets/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
});
```

**Step 3: Build and deploy**

Run: `npm run build && npx wrangler deploy`
Expected: Deployment succeeds, dashboard loads from CDN-cached static assets.

---

### Task 6: Add SSE endpoint for real-time updates

**Files:**
- Create: `src/api/routes/events.ts`
- Modify: `src/api/index.ts` (mount the route)
- Test: `tests/api/routes/events.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/api/routes/events.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/api/index.js';
import dotenv from 'dotenv';
dotenv.config();

const TEST_DB = process.env.DATABASE_URL;

describe('GET /api/events', () => {
  it('returns SSE content type', async () => {
    if (!TEST_DB) return; // skip in CI without DB
    const { app } = createApp(TEST_DB);
    const res = await app.request('/api/events', {
      headers: { 'x-api-key': 'test-key' },
    });
    // Should be SSE or 401 (no valid auth)
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    }
  });
});
```

**Step 2: Implement the SSE endpoint**

Create `src/api/routes/events.ts`:

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq, and, gt, desc, sql } from 'drizzle-orm';
import { assessmentEvents, member } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { pMastery } from '../../schemas/types.js';
import type { Env } from '../index.js';

export const eventRoutes = new Hono<Env>();

eventRoutes.use('*', requireAuth);

eventRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  // Find user's org members for scoping
  const memberships = await db.select({ organizationId: member.organizationId })
    .from(member).where(eq(member.userId, user.id)).limit(1);

  let orgMemberIds: string[] = [user.id];
  if (memberships.length > 0) {
    const orgMembers = await db.select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, memberships[0].organizationId));
    orgMemberIds = orgMembers.map(m => m.userId);
  }

  // Get Last-Event-ID for incremental updates
  const lastEventId = parseInt(c.req.header('Last-Event-ID') || '0') || 0;

  return streamSSE(c, async (stream) => {
    // Set retry interval
    await stream.writeSSE({ event: 'connected', data: JSON.stringify({ retry: 3000 }) });

    let currentLastId = lastEventId;
    const maxIterations = 8; // ~24s of connection (3s per iteration)

    for (let i = 0; i < maxIterations; i++) {
      // Query for new events since last seen
      const newEvents = await db.select().from(assessmentEvents)
        .where(and(
          gt(assessmentEvents.id, currentLastId),
          sql`${assessmentEvents.userId} = ANY(${orgMemberIds})`,
        ))
        .orderBy(assessmentEvents.id)
        .limit(20);

      for (const event of newEvents) {
        await stream.writeSSE({
          event: 'mastery_update',
          data: JSON.stringify({
            userId: event.userId,
            conceptId: event.conceptId,
            eventType: event.eventType,
            score: event.rubricScore,
            masteryBefore: Math.round(pMastery(event.muBefore) * 100),
            masteryAfter: Math.round(pMastery(event.muAfter) * 100),
            createdAt: event.createdAt,
          }),
          id: String(event.id),
        });
        currentLastId = event.id;
      }

      // Heartbeat
      await stream.writeSSE({ event: 'heartbeat', data: '' });

      // Wait 3 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  });
});
```

**Step 3: Mount the route**

In `src/api/index.ts`, add:

```typescript
import { eventRoutes } from './routes/events.js';
// ...
app.route('/api/events', eventRoutes);
```

Add it before the dashboard route (after other `/api/*` routes).

**Step 4: Run tests**

Run: `npx vitest run tests/api/routes/events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/routes/events.ts src/api/index.ts tests/api/routes/events.test.ts
git commit -m "feat: add SSE endpoint for real-time mastery updates"
```

---

### Task 7: Add SSE client to dashboard JS

**Files:**
- Modify: `src/dashboard/dashboard.js`

**Step 1: Add EventSource connection**

Add to the end of the IIFE, after the init logic, but inside the closure:

```javascript
// --- Real-time updates via SSE ---

var eventSource = null;

function connectSSE() {
  if (eventSource) eventSource.close();
  var url = "/api/events";
  var headers = {};
  if (token) {
    // EventSource doesn't support custom headers, use query param
    url += "?token=" + encodeURIComponent(token);
  }
  eventSource = new EventSource(url, { withCredentials: true });

  eventSource.addEventListener("mastery_update", function(e) {
    var data = JSON.parse(e.data);
    handleMasteryUpdate(data);
  });

  eventSource.addEventListener("connected", function() {
    showLiveIndicator(true);
  });

  eventSource.onerror = function() {
    showLiveIndicator(false);
  };
}

function handleMasteryUpdate(data) {
  // Update concept mastery in the grid if visible
  if (allMasteryMap[data.conceptId]) {
    // Update mu from mastery percentage back to mu (approximate)
    // Better: store raw mu, but pct is what we have from SSE
    allMasteryMap[data.conceptId].mu = -Math.log(100 / data.masteryAfter - 1);
    allMasteryMap[data.conceptId].lastAssessed = data.createdAt;
    // Re-render the current filter
    var activeFilter = document.querySelector(".filter-btn.active");
    var domain = activeFilter && activeFilter.textContent !== "All" ? activeFilter.textContent : null;
    renderConceptList(domain);
  }

  // Flash notification
  showUpdateToast(data);
}

function showLiveIndicator(connected) {
  var meta = document.getElementById("header-meta");
  if (!meta) return;
  meta.textContent = connected ? "Live" : "";
  meta.style.color = connected ? "var(--green)" : "var(--text-tertiary)";
}

function showUpdateToast(data) {
  var delta = data.masteryAfter - data.masteryBefore;
  var sign = delta >= 0 ? "+" : "";
  var msg = data.conceptId + ": " + data.masteryBefore + "% → " + data.masteryAfter + "% (" + sign + delta + "%)";

  var toast = h("div", { className: "toast" }, msg);
  document.body.appendChild(toast);
  setTimeout(function() { toast.classList.add("show"); }, 10);
  setTimeout(function() {
    toast.classList.remove("show");
    setTimeout(function() { toast.remove(); }, 300);
  }, 3000);
}
```

**Step 2: Call `connectSSE()` in `showDashboard()`**

Add `connectSSE();` after `loadData();` in the `showDashboard()` function.

**Step 3: Add toast CSS**

Add to `src/dashboard/dashboard.css`:

```css
/* Toast notifications */
.toast {
  position: fixed; bottom: 1.5rem; right: 1.5rem;
  padding: 0.6rem 1rem; background: var(--bg-card);
  border: 1px solid var(--border); border-radius: 8px;
  font-size: 0.8rem; color: var(--text);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  opacity: 0; transform: translateY(10px);
  transition: opacity 0.3s, transform 0.3s;
  z-index: 200; font-family: var(--mono);
}
.toast.show { opacity: 1; transform: translateY(0); }
```

---

### Task 8: Support auth token in SSE query param

**Files:**
- Modify: `src/api/routes/events.ts`
- Modify: `src/api/index.ts` (session middleware)

**Step 1: Handle token query param for SSE**

`EventSource` doesn't support custom headers. The dashboard passes the token as a query param. The session middleware needs to check `?token=` for SSE routes.

In the session middleware in `src/api/index.ts`, add before the existing `auth.api.getSession` call:

```typescript
// Support token query param for SSE (EventSource can't set headers)
const tokenParam = new URL(c.req.url).searchParams.get('token');
if (tokenParam && !c.req.header('Authorization')) {
  c.req.raw.headers.set('Authorization', `Bearer ${tokenParam}`);
}
```

**Step 2: Verify SSE auth works with bearer token**

Test manually:
```bash
curl -N "http://localhost:3456/api/events?token=YOUR_TOKEN"
```
Expected: SSE stream with `event: connected` followed by heartbeats.

---

### Task 9: Run full test suite + build verification

**Step 1: Run tests**

Run: `npm test`
Expected: All tests pass (existing + new events test)

**Step 2: Run full build**

Run: `npm run build`
Expected: Dashboard assets built to `public/assets/` with manifest

**Step 3: Verify locally**

Run: `npm run api:dev`
- Visit `http://localhost:3456` — dashboard loads with external CSS/JS
- Check Network tab — CSS/JS loaded from `/assets/` paths
- Check "Live" indicator in header

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: dashboard static assets + SSE real-time updates"
```

---

### Task 10: Deploy and smoke test

**Step 1: Build**

Run: `npm run build`

**Step 2: Deploy**

Run: `npx wrangler deploy`

**Step 3: Smoke test**

1. Visit `https://entendi-api.tomaskorenblit.workers.dev`
2. Verify dashboard loads (CSS/JS from CDN)
3. Check Network tab: static assets have `cache-control: public, max-age=31536000, immutable`
4. Check "Live" indicator shows
5. Trigger a probe via MCP, verify the dashboard updates live

**Step 4: Commit deploy verification**

```bash
git commit --allow-empty -m "chore: verify production deploy of dashboard optimization"
```
