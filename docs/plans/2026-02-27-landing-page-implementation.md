# Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a public-facing landing page, press page, and contact page to entendi.dev, served through the existing Cloudflare Worker.

**Architecture:** Three new HTML pages served from `src/api/routes/public.ts`. Landing page checks auth — logged in gets dashboard, logged out gets the landing page. Three new DB tables for waitlist, press mentions, and contact submissions. Three new API endpoints. Shared CSS inline in each page (reuses design tokens from dashboard).

**Tech Stack:** Hono routes, Drizzle ORM schema, Neon PostgreSQL, vanilla HTML/CSS/JS, Vitest

---

### Task 1: Database Schema — Add Three New Tables

**Files:**
- Modify: `src/api/db/schema.ts` (append after line ~451)

**Step 1: Write the failing test**

Create `tests/api/routes/public.test.ts`:

```typescript
import { config } from 'dotenv';
config();

import { describe, it, expect } from 'vitest';
import { waitlistSignups, pressMentions, contactSubmissions } from '../../../src/api/db/schema.js';

describe('Public page schema', () => {
  it('exports waitlistSignups table', () => {
    expect(waitlistSignups).toBeDefined();
  });

  it('exports pressMentions table', () => {
    expect(pressMentions).toBeDefined();
  });

  it('exports contactSubmissions table', () => {
    expect(contactSubmissions).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/routes/public.test.ts`
Expected: FAIL — cannot resolve `waitlistSignups` etc.

**Step 3: Write minimal implementation**

Add to `src/api/db/schema.ts` at the end:

```typescript
// --- Public Pages ---

export const waitlistSignups = pgTable('waitlist_signups', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pressMentions = pgTable('press_mentions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  source: text('source').notNull(),
  url: text('url').notNull(),
  publishedAt: date('published_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contactSubmissions = pgTable('contact_submissions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Note: Use text IDs with `crypto.randomUUID()` at insert time (consistent with other tables in this project).

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/routes/public.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/db/schema.ts tests/api/routes/public.test.ts
git commit -m "feat: add waitlist, press, contact DB schema"
```

---

### Task 2: Create Database Tables in Neon

**Step 1: Run migration SQL**

Run against the Neon database (project `little-union-75634107`):

```sql
CREATE TABLE IF NOT EXISTS waitlist_signups (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS press_mentions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_submissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Step 2: Verify tables exist**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('waitlist_signups', 'press_mentions', 'contact_submissions');
```

Expected: 3 rows returned.

**Step 3: No commit needed** (DB migration, not code)

---

### Task 3: API Endpoints — Waitlist, Press, Contact

**Files:**
- Create: `src/api/routes/public.ts`
- Modify: `src/api/index.ts` (add route import + mount)

**Step 1: Add tests to `tests/api/routes/public.test.ts`**

Append integration tests after the schema tests:

```typescript
const testDbUrl = process.env.DATABASE_URL;
const testSecret = process.env.BETTER_AUTH_SECRET;
const canRun = testDbUrl && testSecret && process.env.INTEGRATION_TESTS === '1';
const describeWithDb = canRun ? describe : describe.skip;

describeWithDb('Public API routes (integration)', () => {
  const { app } = createApp(testDbUrl!, { secret: testSecret! });

  it('POST /api/waitlist accepts valid email', async () => {
    const email = `test-${Date.now()}@example.com`;
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('POST /api/waitlist rejects invalid email', async () => {
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/waitlist returns 409 for duplicate', async () => {
    const email = `dup-${Date.now()}@example.com`;
    await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const res = await app.request('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(409);
  });

  it('GET /api/press returns array', async () => {
    const res = await app.request('/api/press');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/contact accepts valid submission', async () => {
    const res = await app.request('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: 'test@example.com',
        message: 'Hello',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('POST /api/contact rejects missing fields', async () => {
    const res = await app.request('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(400);
  });
});
```

Add import at top of test file: `import { createApp } from '../../../src/api/index.js';`

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/routes/public.test.ts`
Expected: FAIL — routes don't exist yet

**Step 3: Create `src/api/routes/public.ts`**

```typescript
import { Hono } from 'hono';
import { desc } from 'drizzle-orm';
import { waitlistSignups, pressMentions, contactSubmissions } from '../db/schema.js';
import type { Env } from '../index.js';

export const publicRoutes = new Hono<Env>();

// POST /api/waitlist
publicRoutes.post('/waitlist', async (c) => {
  const body = await c.req.json();
  const email = body?.email?.trim()?.toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Valid email required' }, 400);
  }

  const db = c.get('db');
  try {
    await db.insert(waitlistSignups).values({
      id: crypto.randomUUID(),
      email,
      ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
    });
    return c.json({ ok: true });
  } catch (err: any) {
    if (err?.code === '23505' || err?.message?.includes('unique')) {
      return c.json({ error: 'Already signed up' }, 409);
    }
    throw err;
  }
});

// GET /api/press
publicRoutes.get('/press', async (c) => {
  const db = c.get('db');
  const rows = await db.select().from(pressMentions).orderBy(desc(pressMentions.createdAt));
  return c.json(rows);
});

// POST /api/contact
publicRoutes.post('/contact', async (c) => {
  const body = await c.req.json();
  const name = body?.name?.trim();
  const email = body?.email?.trim()?.toLowerCase();
  const message = body?.message?.trim();

  if (!name || !email || !message) {
    return c.json({ error: 'Name, email, and message are required' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Valid email required' }, 400);
  }

  const db = c.get('db');
  await db.insert(contactSubmissions).values({
    id: crypto.randomUUID(),
    name,
    email,
    message,
  });
  return c.json({ ok: true });
});
```

**Step 4: Mount routes in `src/api/index.ts`**

Add import: `import { publicRoutes } from './routes/public.js';`

Add route mount after the other routes (before `/assets/*`):

```typescript
app.route('/api', publicRoutes);
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/api/routes/public.test.ts`
Expected: PASS (schema tests pass; integration tests pass if `INTEGRATION_TESTS=1`)

**Step 6: Commit**

```bash
git add src/api/routes/public.ts src/api/index.ts tests/api/routes/public.test.ts
git commit -m "feat: add waitlist, press, contact API endpoints"
```

---

### Task 4: Shared HTML Helpers — Nav + Page Shell

**Files:**
- Create: `src/api/routes/public-html.ts`

**Step 1: No test needed** (HTML generation — tested via route integration tests)

**Step 2: Create `src/api/routes/public-html.ts`**

This file contains the shared HTML shell, nav, and CSS tokens for all public pages. The CSS is inline (no external stylesheet needed — keeps it self-contained).

```typescript
const LAUNCH_DATE = new Date('2026-02-27T00:00:00Z');

export function daysSinceLaunch(): number {
  return Math.floor((Date.now() - LAUNCH_DATE.getTime()) / (1000 * 60 * 60 * 24));
}

function nav(active: 'home' | 'press' | 'contact'): string {
  const link = (href: string, label: string, key: typeof active) =>
    `<a href="${href}" class="nav-link${active === key ? ' active' : ''}">${label}</a>`;
  return `<nav class="site-nav">
    ${link('/', 'entendi', 'home')}
    <span class="nav-sep">|</span>
    ${link('/press', 'press', 'press')}
    <span class="nav-sep">|</span>
    ${link('/contact', 'contact', 'contact')}
  </nav>`;
}

export function publicShell(title: string, active: 'home' | 'press' | 'contact', body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231a1a2e'/%3E%3Cpath d='M 19.5 7 C 19.5 3.5 15.5 3.5 15.5 7 L 15.5 22' stroke='white' stroke-width='3' stroke-linecap='round' fill='none'/%3E%3Ccircle cx='15.5' cy='27' r='2' fill='white'/%3E%3C/svg%3E"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: #F6F4F1; --bg-card: #EDEAE5; --border: #E0DCD6;
      --text: #1F1F1F; --text-secondary: #7A7268; --text-tertiary: #9B9389;
      --accent: #C4704B; --accent-hover: #A85D3D;
      --green: #5B7B5E; --red: #B84233;
      --font-display: 'Source Serif 4', Georgia, 'Times New Roman', serif;
      --font-body: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-body); background: var(--bg); color: var(--text);
      min-height: 100vh; -webkit-font-smoothing: antialiased;
    }
    .site-nav {
      padding: 1.5rem 2rem; font-size: 0.85rem; color: var(--text-secondary);
      display: flex; align-items: center; gap: 0.5rem;
    }
    .nav-link {
      color: var(--text-secondary); text-decoration: none; font-weight: 400;
    }
    .nav-link:hover { color: var(--text); }
    .nav-link.active { color: var(--text); font-weight: 500; }
    .nav-sep { color: var(--border); user-select: none; }
    .page-body {
      max-width: 700px; margin: 0 auto; padding: 0 2rem;
    }
  </style>
</head>
<body>
  ${nav(active)}
  <div class="page-body">
    ${body}
  </div>
</body>
</html>`;
}
```

**Step 3: Commit**

```bash
git add src/api/routes/public-html.ts
git commit -m "feat: add shared HTML shell for public pages"
```

---

### Task 5: Landing Page Route (logged out = landing, logged in = dashboard)

**Files:**
- Modify: `src/api/routes/dashboard.ts` (change `/` handler to check auth)
- Uses: `src/api/routes/public-html.ts`

**Step 1: Write test**

Add to `tests/api/routes/public.test.ts`:

```typescript
describe('Landing page HTML', () => {
  it('GET / returns HTML with landing page content when not logged in', async () => {
    const { app } = createApp(testDbUrl!, { secret: testSecret! });
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('entendi');
    expect(html).toContain('Join the waitlist');
  });
});
```

(Wrap in `describeWithDb` since it needs a real app instance.)

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/routes/public.test.ts`

**Step 3: Modify `src/api/routes/dashboard.ts`**

Update the `GET /` handler to check if user is logged in. If not, serve the landing page instead of the dashboard:

```typescript
import { publicShell } from './public-html.js';

// Replace the existing GET '/' handler:
dashboardRoutes.get('/', (c) => {
  const user = c.get('user');

  if (!user) {
    // Serve landing page for unauthenticated visitors
    return c.html(getLandingHTML());
  }

  // Existing dashboard behavior for logged-in users
  const etag = `"${manifestHash}"`;
  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304);
  }
  c.header('Cache-Control', 'public, max-age=300');
  c.header('ETag', etag);
  return c.html(getShellHTML());
});
```

Add `getLandingHTML()` function in `dashboard.ts` (or import from `public-html.ts`):

```typescript
function getLandingHTML(): string {
  return publicShell('Entendi — Comprehension accountability for AI-assisted work', 'home', `
  <style>
    .landing { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: calc(100vh - 120px); text-align: center; }
    .landing h1 { font-family: var(--font-display); font-size: 2.25rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; max-width: 600px; margin-bottom: 1.5rem; }
    .landing .subtitle { color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; max-width: 480px; margin-bottom: 2rem; }
    .landing .bullets { list-style: none; text-align: left; max-width: 420px; margin-bottom: 2rem; }
    .landing .bullets li { color: var(--text-secondary); font-size: 0.875rem; line-height: 1.5; padding: 0.35rem 0; padding-left: 1.25rem; position: relative; }
    .landing .bullets li::before { content: '—'; position: absolute; left: 0; color: var(--accent); }
    .demo-placeholder {
      width: 100%; max-width: 480px; height: 240px; background: var(--bg-card);
      border: 1px dashed var(--border); border-radius: 8px; margin-bottom: 2rem;
      display: flex; align-items: center; justify-content: center;
      color: var(--text-tertiary); font-size: 0.8rem;
    }
    .waitlist-form { display: flex; gap: 0.5rem; max-width: 400px; width: 100%; }
    .waitlist-form input {
      flex: 1; padding: 0.6rem 0.85rem; border: 1px solid var(--border); border-radius: 6px;
      font-size: 0.85rem; font-family: var(--font-body); outline: none; background: white;
    }
    .waitlist-form input:focus { border-color: var(--accent); }
    .waitlist-form button {
      padding: 0.6rem 1.25rem; border: none; border-radius: 6px; background: var(--accent);
      color: white; font-size: 0.85rem; font-weight: 600; font-family: var(--font-body);
      cursor: pointer; white-space: nowrap;
    }
    .waitlist-form button:hover { background: var(--accent-hover); }
    .waitlist-form button:disabled { opacity: 0.6; cursor: not-allowed; }
    .waitlist-msg { font-size: 0.8rem; margin-top: 0.5rem; min-height: 1.2em; }
    .waitlist-msg.success { color: var(--green); }
    .waitlist-msg.error { color: var(--red); }
  </style>
  <div class="landing">
    <h1>Know what you know.</h1>
    <p class="subtitle">Entendi is a comprehension accountability layer for AI-assisted work. It watches how you learn with AI and makes sure you actually understand what you're building.</p>
    <ul class="bullets">
      <li>Observes concepts as you work with AI tools</li>
      <li>Probes your understanding with Socratic questions</li>
      <li>Builds a Bayesian knowledge graph of what you actually know</li>
    </ul>
    <div class="demo-placeholder">demo gif coming soon</div>
    <form class="waitlist-form" id="waitlist-form">
      <input type="email" placeholder="you@example.com" required id="waitlist-email"/>
      <button type="submit">Join the waitlist</button>
    </form>
    <div class="waitlist-msg" id="waitlist-msg"></div>
  </div>
  <script>
    document.getElementById('waitlist-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      const msg = document.getElementById('waitlist-msg');
      const email = document.getElementById('waitlist-email').value;
      btn.disabled = true;
      msg.textContent = '';
      msg.className = 'waitlist-msg';
      try {
        const res = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          msg.textContent = "You're on the list. We'll be in touch.";
          msg.className = 'waitlist-msg success';
          document.getElementById('waitlist-email').value = '';
        } else if (res.status === 409) {
          msg.textContent = "You're already on the list!";
          msg.className = 'waitlist-msg success';
        } else {
          const body = await res.json();
          msg.textContent = body.error || 'Something went wrong.';
          msg.className = 'waitlist-msg error';
        }
      } catch {
        msg.textContent = 'Network error. Try again.';
        msg.className = 'waitlist-msg error';
      }
      btn.disabled = false;
    });
  </script>`);
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/api/routes/public.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/routes/dashboard.ts tests/api/routes/public.test.ts
git commit -m "feat: serve landing page for unauthenticated visitors"
```

---

### Task 6: Press Page Route

**Files:**
- Modify: `src/api/routes/dashboard.ts` (add `/press` route)

**Step 1: Write test**

Add to `tests/api/routes/public.test.ts` inside `describeWithDb`:

```typescript
it('GET /press returns press page HTML', async () => {
  const res = await app.request('/press');
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('press');
  expect(html).toContain('days');
});
```

**Step 2: Run test to verify it fails**

**Step 3: Add press route to `dashboard.ts`**

```typescript
import { daysSinceLaunch, publicShell } from './public-html.js';

dashboardRoutes.get('/press', async (c) => {
  const db = c.get('db');
  const rows = await db.select().from(pressMentions).orderBy(desc(pressMentions.createdAt));

  let content: string;
  if (rows.length === 0) {
    const days = daysSinceLaunch();
    content = `
      <style>
        .press-empty { margin-top: 8rem; text-align: center; }
        .press-empty h2 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; }
        .press-empty p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6; max-width: 400px; margin: 0 auto; }
      </style>
      <div class="press-empty">
        <h2>Press</h2>
        <p>We've been live for ${days} day${days !== 1 ? 's' : ''}. We're sure the press will come.</p>
      </div>`;
  } else {
    const items = rows.map(r => `
      <li class="press-item">
        <a href="${r.url}" target="_blank" rel="noopener">${r.title}</a>
        <span class="press-meta">${r.source}${r.publishedAt ? ` · ${r.publishedAt}` : ''}</span>
      </li>`).join('');
    content = `
      <style>
        .press-page { margin-top: 4rem; }
        .press-page h2 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; }
        .press-list { list-style: none; }
        .press-item { padding: 0.75rem 0; border-bottom: 1px solid var(--border); }
        .press-item a { color: var(--text); text-decoration: none; font-weight: 500; font-size: 0.9rem; }
        .press-item a:hover { color: var(--accent); }
        .press-meta { display: block; color: var(--text-tertiary); font-size: 0.8rem; margin-top: 0.25rem; }
      </style>
      <div class="press-page">
        <h2>Press</h2>
        <ul class="press-list">${items}</ul>
      </div>`;
  }

  return c.html(publicShell('Press — Entendi', 'press', content));
});
```

Add imports at top of `dashboard.ts`:
```typescript
import { desc } from 'drizzle-orm';
import { pressMentions } from '../db/schema.js';
```

**Step 4: Run tests**

Run: `npx vitest run tests/api/routes/public.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/routes/dashboard.ts tests/api/routes/public.test.ts
git commit -m "feat: add press page with empty state"
```

---

### Task 7: Contact Page Route

**Files:**
- Modify: `src/api/routes/dashboard.ts` (add `/contact` route)

**Step 1: Write test**

Add to `tests/api/routes/public.test.ts` inside `describeWithDb`:

```typescript
it('GET /contact returns contact page HTML', async () => {
  const res = await app.request('/contact');
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('contact');
  expect(html).toContain('form');
});
```

**Step 2: Run test to verify it fails**

**Step 3: Add contact route to `dashboard.ts`**

```typescript
dashboardRoutes.get('/contact', (c) => {
  const content = `
    <style>
      .contact-page { margin-top: 4rem; max-width: 480px; }
      .contact-page h2 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; }
      .contact-form label { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem; margin-top: 1rem; }
      .contact-form label:first-child { margin-top: 0; }
      .contact-form input, .contact-form textarea {
        width: 100%; padding: 0.6rem 0.85rem; border: 1px solid var(--border); border-radius: 6px;
        font-size: 0.85rem; font-family: var(--font-body); outline: none; background: white;
      }
      .contact-form input:focus, .contact-form textarea:focus { border-color: var(--accent); }
      .contact-form textarea { min-height: 120px; resize: vertical; }
      .contact-form button {
        margin-top: 1.25rem; padding: 0.6rem 1.5rem; border: none; border-radius: 6px;
        background: var(--accent); color: white; font-size: 0.85rem; font-weight: 600;
        font-family: var(--font-body); cursor: pointer;
      }
      .contact-form button:hover { background: var(--accent-hover); }
      .contact-form button:disabled { opacity: 0.6; cursor: not-allowed; }
      .contact-msg { font-size: 0.8rem; margin-top: 0.5rem; min-height: 1.2em; }
      .contact-msg.success { color: var(--green); }
      .contact-msg.error { color: var(--red); }
    </style>
    <div class="contact-page">
      <h2>Contact</h2>
      <form class="contact-form" id="contact-form">
        <label for="c-name">Name</label>
        <input type="text" id="c-name" required/>
        <label for="c-email">Email</label>
        <input type="email" id="c-email" required/>
        <label for="c-message">Message</label>
        <textarea id="c-message" required></textarea>
        <button type="submit">Send</button>
      </form>
      <div class="contact-msg" id="contact-msg"></div>
    </div>
    <script>
      document.getElementById('contact-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const msg = document.getElementById('contact-msg');
        btn.disabled = true;
        msg.textContent = '';
        msg.className = 'contact-msg';
        try {
          const res = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: document.getElementById('c-name').value,
              email: document.getElementById('c-email').value,
              message: document.getElementById('c-message').value,
            }),
          });
          if (res.ok) {
            msg.textContent = 'Message sent. Thanks!';
            msg.className = 'contact-msg success';
            e.target.reset();
          } else {
            const body = await res.json();
            msg.textContent = body.error || 'Something went wrong.';
            msg.className = 'contact-msg error';
          }
        } catch {
          msg.textContent = 'Network error. Try again.';
          msg.className = 'contact-msg error';
        }
        btn.disabled = false;
      });
    </script>`;

  return c.html(publicShell('Contact — Entendi', 'contact', content));
});
```

**Step 4: Run tests**

Run: `npx vitest run tests/api/routes/public.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/routes/dashboard.ts tests/api/routes/public.test.ts
git commit -m "feat: add contact page with form"
```

---

### Task 8: Wrangler Config — Add New Routes

**Files:**
- Modify: `wrangler.toml`

**Step 1: Update `run_worker_first`**

Change line 16 from:
```toml
run_worker_first = ["/api/*", "/health", "/", "/link"]
```
To:
```toml
run_worker_first = ["/api/*", "/health", "/", "/link", "/press", "/contact"]
```

**Step 2: Verify existing tests still pass**

Run: `npx vitest run`
Expected: All existing tests pass

**Step 3: Commit**

```bash
git add wrangler.toml
git commit -m "feat: add /press and /contact to worker routes"
```

---

### Task 9: Run Full Test Suite + Verify Locally

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

**Step 2: Start local dev server**

Run: `npm run api:dev`

Verify manually:
- `http://localhost:3456/` — shows landing page (when not logged in)
- `http://localhost:3456/press` — shows press page with days counter
- `http://localhost:3456/contact` — shows contact form
- Submit waitlist form — check response
- Submit contact form — check response

**Step 3: No commit** (verification only)

---

### Task 10: Infrastructure — DNS + Deploy (Manual Steps)

**IMPORTANT: Rotate your leaked API keys before proceeding.**

**Step 1: Rotate credentials**
- Porkbun: Generate new API key in account settings
- Cloudflare: Revoke the leaked API token and Global API key, create new ones

**Step 2: Set up Cloudflare custom domain**
- In Cloudflare dashboard → Workers & Pages → entendi-api → Settings → Domains
- Add custom domain: `entendi.dev`
- Cloudflare will handle DNS if nameservers point to Cloudflare, or you add a CNAME at Porkbun

**Step 3: Point Porkbun nameservers to Cloudflare** (if using Cloudflare DNS)
- Or: Add CNAME record at Porkbun pointing `entendi.dev` to the worker URL

**Step 4: Deploy**

```bash
npx wrangler deploy
```

**Step 5: Verify**
- `https://entendi.dev/` — landing page
- `https://entendi.dev/press` — press page
- `https://entendi.dev/contact` — contact form
