# Dashboard Optimization: Static Assets + Caching + Real-Time Updates

## Problem

1. The dashboard is an 80KB HTML string generated per-request with all CSS (~360 lines) and JS (~1100 lines) inlined. No caching headers, no minification, no content hashing. Every page load transfers the full 80KB.
2. Dashboard shows stale data — when a team member gets probed and their mastery changes, you only see it on manual refresh.

## Solution

1. Extract CSS and JS into standalone files, minify at build time, serve via Cloudflare Workers Static Assets with content-hash filenames for infinite caching.
2. Add SSE (Server-Sent Events) endpoint for real-time mastery updates — dashboard updates live when any org member's mastery changes.

## Architecture

```
Before:  Worker → getDashboardHTML() → 80KB inline HTML (every request)

After:   /                     → Worker → ~3KB HTML shell (5min cache + ETag)
         /assets/dashboard-[hash].css  → CF Static Assets (immutable, 1yr cache)
         /assets/dashboard-[hash].js   → CF Static Assets (immutable, 1yr cache)
         /assets/link-[hash].js        → CF Static Assets (immutable, 1yr cache)
         /api/*                → Worker (unchanged)
```

## Changes

### 1. Extract static files from dashboard.ts

Split the single 1828-line file into:
- `src/dashboard/dashboard.css` — all CSS from the `<style>` block
- `src/dashboard/dashboard.js` — all JS from the `<script>` block
- `src/dashboard/link.js` — device-link page JS
- `src/api/routes/dashboard.ts` — thin HTML shell that references hashed assets

### 2. Build step: minify + content-hash

Add to `esbuild.config.ts`:
- Bundle `src/dashboard/*.{css,js}` with `minify: true`
- Output to `public/assets/` with `entryNames: '[name]-[hash]'`
- Generate a manifest JSON mapping original names → hashed filenames
- Dashboard route reads the manifest to inject correct `<link>`/`<script>` URLs

### 3. Cloudflare Workers Static Assets

Add to `wrangler.toml`:
```toml
[assets]
directory = "public"
run_worker_first = ["/api/*", "/health"]
not_found_handling = "none"
```

Static assets in `public/assets/` are served directly from Cloudflare's CDN edge — they never hit the Worker. The Worker only handles API routes and the HTML shell.

### 4. Caching headers

- **Static assets** (`/assets/*`): `Cache-Control: public, max-age=31536000, immutable` — content-hashed filenames mean the URL changes when content changes, so infinite caching is safe.
- **HTML shell** (`/`): `Cache-Control: public, max-age=300` + ETag based on asset manifest hash. Revalidates every 5 minutes; after deploy, new manifest = new ETag = fresh response.

### 5. HTML shell template

The dashboard route becomes:
```typescript
dashboardRoutes.get('/', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  c.header('ETag', `"${manifestHash}"`);
  if (c.req.header('If-None-Match') === `"${manifestHash}"`) {
    return c.body(null, 304);
  }
  return c.html(getShellHTML(manifest));
});
```

Where `getShellHTML` returns a ~3KB HTML string with `<link href="/assets/dashboard-abc123.css">` and `<script src="/assets/dashboard-abc123.js">`.

## Performance Impact

| Metric | Before | After |
|--------|--------|-------|
| First visit transfer | ~80KB | ~3KB HTML + ~25KB assets (gzipped) |
| Repeat visit transfer | ~80KB | ~0KB (304) or ~3KB (revalidation) |
| Asset caching | None | Immutable, CDN-edge cached globally |
| Time to interactive | Blocked on 80KB parse | HTML shell loads instantly, assets cached |

## Real-Time Updates via SSE

### SSE endpoint: `GET /api/events`

Stream real-time mastery changes to the dashboard.

**Flow:**
```
Browser EventSource → GET /api/events
                    ← event: mastery_update { userId, conceptId, mastery, ... }
                    ← event: mastery_update { ... }
                    ← (heartbeat every 15s)
                    ← (auto-reconnects on disconnect)
```

**Workers constraint:** Workers can't hold connections indefinitely. The SSE endpoint uses a reconnect-based approach:
1. Client connects with `EventSource` (sends `Last-Event-ID` on reconnect)
2. Server queries `assessment_events` for events newer than `Last-Event-ID`
3. Streams any new events, then holds connection with heartbeats for ~25s
4. Connection closes, client auto-reconnects (SSE `retry: 3000`)
5. On reconnect, only new events since last seen ID are sent

**Event types:**
- `mastery_update` — a user's concept mastery changed (from record-evaluation or tutor)
- `heartbeat` — keep-alive, no data

**Dashboard JS changes:**
- Connect `EventSource` to `/api/events` on page load
- On `mastery_update`: update concept mastery in the grid, flash the changed row
- On org tab: update member mastery stats live
- Visual indicator showing "Live" connection status

**Scoping:** Events are scoped to the user's org — you only see updates from org members, not all users.

## What Doesn't Change

- Vanilla JS approach (no framework)
- XSS protection (textContent discipline)
- API endpoints and auth flow
- Device-link page (same treatment: extract + hash)
- Deploy command (`npx wrangler deploy`)
