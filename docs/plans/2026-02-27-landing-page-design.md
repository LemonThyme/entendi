# Landing Page Design

## Overview

Simple three-page public site for entendi.dev. No frameworks, no scrolling on landing page, extends existing design system.

## Navigation

Top-left, plain text with pipe separators:

```
entendi | press | contact
```

- `entendi` links to `/`
- `press` links to `/press`
- `contact` links to `/contact`
- Body font (DM Sans), regular weight, small size
- No hamburger menu, no mobile collapse — it's three words

## Routes

### `/` — Home

**Logged in**: Serve existing dashboard (current behavior).

**Logged out**: Landing page. Single viewport, no scroll.

- **Headline**: One-liner in Source Serif 4, large. Something like "Comprehension accountability for AI-assisted work."
- **Three short bullets**: How it works / why it matters. Body font, secondary text color.
- **Demo area**: Placeholder image/gif. Centered. Modest size.
- **Waitlist CTA**: Email input + "Join the waitlist" button. Terracotta accent (`--accent`). Inline, centered below demo.
- **Layout**: Vertically centered in viewport. Max-width ~700px. Generous whitespace.

### `/press`

- Same nav at top
- Empty state: "We've been live for {N} days. We're sure the press will come." (N computed from Feb 27 2026)
- When press entries exist: simple list — title, source, date, link
- Data from `press_mentions` table (title, source, url, published_at, created_at)

### `/contact`

- Same nav at top
- Simple form: name, email, message (textarea)
- Submit stores to `contact_submissions` table
- Inline success message after submit
- Basic validation (required fields, email format)

## Database

Three new tables:

```sql
CREATE TABLE waitlist_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE press_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Visual Design

Uses existing design tokens from `dashboard.css`:

- Background: `--bg` (#F6F4F1)
- Text: `--text` (#1F1F1F), `--text-secondary` (#7A7268)
- Accent/CTA: `--accent` (#C4704B)
- Fonts: `--font-display` (Source Serif 4), `--font-body` (DM Sans)
- Border radius: 6px inputs, 8px buttons
- No new colors, no new fonts, no new patterns

## API Endpoints

- `POST /api/waitlist` — email submission, duplicate check, returns 200/409
- `GET /api/press` — returns press mentions ordered by published_at desc
- `POST /api/contact` — form submission, basic validation, returns 200
- `GET /press` — press page HTML
- `GET /contact` — contact page HTML

## Infrastructure

Landing page served through existing Cloudflare Worker. Add `/press` and `/contact` to `run_worker_first` in wrangler.toml. No separate deployment.

## Non-goals

- No animations, scroll effects, or motion
- No blog, docs, or pricing
- No authentication on public pages
- No email notifications on form submit (just store)
- No full CMS — press entries added via DB
