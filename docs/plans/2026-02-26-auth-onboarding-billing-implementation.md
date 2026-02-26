# Auth, Onboarding, Billing & Email Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add social login, device code linking, org management, Stripe billing, and Resend email to Entendi so users can self-onboard, manage teams, and receive mastery summary emails.

**Architecture:** Better Auth handles OAuth (GitHub/Google) and API key generation. Device codes stored in Neon enable CLI-first linking via polling. Stripe Checkout Sessions handle billing (no custom payment UI). Resend sends transactional + periodic mastery summary emails with inline SVG sparklines. Cloudflare Workers Cron Triggers schedule weekly summaries.

**Tech Stack:** Better Auth (social login, org, apiKey plugins), Stripe (checkout + webhooks), Resend (transactional + bulk email), Drizzle ORM (Neon PostgreSQL), Hono (API), Cloudflare Workers (deploy + cron)

**Design Doc:** `docs/plans/2026-02-26-auth-onboarding-billing-design.md`

---

## Task 1: Schema — Add New Tables

**Files:**
- Modify: `src/api/db/schema.ts` (after line 309)

**Step 1: Add new tables to schema**

Add after the last table in `src/api/db/schema.ts`:

```ts
// --- Device Codes (CLI-first auth linking) ---
export const deviceCodes = pgTable('device_codes', {
  code: text('code').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  apiKey: text('api_key'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Subscriptions (Stripe billing) ---
export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  plan: text('plan').notNull(),
  status: text('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  seatCount: integer('seat_count'),
  earnedFreeUntil: timestamp('earned_free_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_subscriptions_user').on(table.userId),
  index('idx_subscriptions_org').on(table.organizationId),
  index('idx_subscriptions_stripe_customer').on(table.stripeCustomerId),
]);

// --- Email Preferences ---
export const emailPreferences = pgTable('email_preferences', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  summaryFrequency: text('summary_frequency').notNull().default('weekly'),
  transactionalEnabled: boolean('transactional_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Step 2: Push schema to Neon**

Run: `npm run db:push`
Expected: Tables created successfully.

**Step 3: Commit**

```bash
git add src/api/db/schema.ts
git commit -m "feat: add device_codes, subscriptions, email_preferences tables"
```

---

## Task 2: Social Login — Better Auth Config

**Files:**
- Modify: `src/api/lib/auth.ts`
- Modify: `src/api/worker.ts`
- Modify: `.env.example`
- Create: `tests/api/auth-config.test.ts`

**Step 1: Write test**

Create `tests/api/auth-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createAuth } from '../../src/api/lib/auth.js';
import { createDb } from '../../src/api/db/connection.js';

describe('auth config', () => {
  it('creates auth with social providers when env vars set', () => {
    process.env.GITHUB_CLIENT_ID = 'test-gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-gh-secret';
    process.env.GOOGLE_CLIENT_ID = 'test-google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    const db = createDb(process.env.DATABASE_URL!);
    const auth = createAuth(db, { secret: 'test-secret', baseURL: 'http://localhost:3456' });
    expect(auth).toBeDefined();
    expect(auth.api).toBeDefined();
  });
});
```

**Step 2: Add social providers to auth config**

In `src/api/lib/auth.ts`, add `socialProviders` config dynamically (only when env vars present). See design doc section 1 for the config shape.

**Step 3: Update `src/api/worker.ts` WorkerEnv to include GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. Set process.env from worker env before createApp().**

**Step 4: Update `.env.example`** with new vars.

**Step 5: Run test, commit**

---

## Task 3: Dashboard — Social Login Buttons

**Files:**
- Modify: `src/api/routes/dashboard.ts`

**Step 1: Add CSS** for `.social-btns`, `.btn-social`, `.divider` after `.btn-link` rule (line 77).

**Step 2: Update showAuth()** (lines 289-309) to include GitHub and Google sign-in buttons above email/password form with "or" divider. Social buttons redirect to `/api/auth/sign-in/social?provider=github&callbackURL=/dashboard`. NOTE: SVG icons for GitHub/Google are static hardcoded strings (safe, consistent with existing dashboard pattern per lines 10-14).

**Step 3: Handle OAuth callback** in Init section — check `/api/me` with credentials when landing on `/dashboard` without a token.

**Step 4: Manual test, commit**

---

## Task 4: Dashboard — API Key Management UI

**Files:**
- Modify: `src/api/routes/dashboard.ts`

**Step 1: Add CSS** for `.tabs`, `.tab-btn`, `.tab-content`, `.key-card`, `.key-new`, `.btn-danger`, `.btn-copy`, `.setup-instructions`.

**Step 2: Add tab navigation** (Overview | Settings) after user-bar. Wrap existing dashboard content in `tab-overview`.

**Step 3: Add Settings tab** with API key management: list keys (`GET /api/keys`), generate (`POST /api/keys`), copy to clipboard, revoke (`DELETE /api/keys/:id`), and setup instructions.

**Step 4: Manual test, commit**

---

## Task 5: Device Code Flow — API Endpoints

**Files:**
- Create: `src/api/routes/device-code.ts`
- Modify: `src/api/index.ts`
- Create: `tests/api/device-code.test.ts`

**Step 1: Write tests** — POST creates pending code (8-char alphanumeric), GET returns status (pending/confirmed/expired).

**Step 2: Implement `src/api/routes/device-code.ts`**:
- `POST /` — generate 8-char code (charset without 0/O/1/I), insert into device_codes, return code + verifyUrl + expiresAt
- `GET /:code` — check status. If expired, clean up. If confirmed, return apiKey and delete row. If pending, return pending.
- `POST /:code/confirm` — requires auth. Validates code is pending and not expired. Calls `auth.api.createApiKey()` for the user. Updates row with userId, apiKey, status=confirmed.

**Step 3: Mount** at `/api/auth/device-code` in `src/api/index.ts`.

**Step 4: Run tests, commit**

---

## Task 6: Device Code — Dashboard Link Page

**Files:**
- Modify: `src/api/routes/dashboard.ts`

**Step 1: Add `/link` route handler** — `dashboardRoutes.get('/link', ...)` returns `getDeviceLinkHTML(code)`.

**Step 2: Implement `getDeviceLinkHTML(code)`** — minimal page that:
- Checks session via `/api/me`
- If logged in: shows "Link device ABCD1234?" with Confirm button
- If not: shows login form, redirects back after auth
- On confirm: POST to `/api/auth/device-code/{code}/confirm`, shows success message

**Step 3: Manual test, commit**

---

## Task 7: Device Code — MCP Login Tool

**Files:**
- Modify: `src/mcp/api-client.ts`
- Modify: `src/mcp/server.ts`

**Step 1: Add API client methods** — `createDeviceCode()` and `pollDeviceCode(code)`.

**Step 2: Add `entendi_login` tool** to MCP server:
- Creates device code via API
- Opens browser using `execFile` (NOT `exec` — prevents shell injection). Use `open` on macOS, `xdg-open` on Linux, `cmd /c start` on Windows.
- Polls every 2s until confirmed or expired (10 min TTL)
- Returns API key with setup instructions

**Step 3: Run MCP tests, commit**

---

## Task 8: Resend Email — Setup & Templates

**Files:**
- Create: `src/api/lib/email.ts`
- Create: `tests/api/email.test.ts`

**Step 1: `npm install resend`**

**Step 2: Write tests** with mocked Resend — verify sendEmail works for OrgInvite, ApiKeyCreated, EarnedFreeUnlocked templates.

**Step 3: Implement `src/api/lib/email.ts`**:
- `EmailTemplate` enum (OrgInvite, ApiKeyCreated, DeviceLinked, EarnedFreeUnlocked, EarnedFreeExpiring, SubscriptionConfirmed, MasterySummary, OrgAdminDigest)
- `getSubject()` and `getHtml()` template functions
- `sendEmail()` — gracefully skips if RESEND_API_KEY not set

**Step 4: Run tests, commit**

---

## Task 9: Org Invite Email — Wire into Better Auth

**Files:**
- Modify: `src/api/lib/auth.ts`

**Step 1: Add `sendInvitationEmail` callback** to organization plugin config. Import `sendEmail` from `./email.js`. Build invite link using `BETTER_AUTH_URL`.

**Step 2: Run all tests, commit**

---

## Task 10: Dashboard — Org Management UI

**Files:**
- Modify: `src/api/routes/dashboard.ts`
- Modify: `src/api/routes/org.ts`

**Step 1: Add Organization tab** to dashboard with create org form, invite form, member list, and mastery rankings.

**Step 2: Add rankings endpoint** to `src/api/routes/org.ts` — query userConceptStates joined with member table, aggregate mastery stats per org member.

**Step 3: Manual test, commit**

---

## Task 11: Stripe — Install & Configure

**Files:**
- Create: `src/api/lib/stripe.ts`
- Create: `src/api/routes/billing.ts`
- Modify: `src/api/index.ts`
- Create: `tests/api/billing.test.ts`

**Step 1: `npm install stripe`**

**Step 2: Write tests** with mocked Stripe — verify createCheckoutSession returns URL.

**Step 3: Implement `src/api/lib/stripe.ts`** — `createCheckoutSession()` and `constructWebhookEvent()`.

**Step 4: Implement `src/api/routes/billing.ts`**:
- `POST /checkout` (auth required) — create Stripe checkout session
- `GET /subscription` (auth required) — get current subscription
- `POST /webhook` (no auth, signature verified) — handle checkout.session.completed, customer.subscription.deleted, invoice.paid

**Step 5: Mount** at `/api/billing` in `src/api/index.ts`.

**Step 6: Run tests, commit**

---

## Task 12: Plan Enforcement — Concept Limits

**Files:**
- Create: `src/api/lib/plan-limits.ts`
- Create: `tests/api/plan-limits.test.ts`
- Modify: `src/api/routes/mcp.ts`

**Step 1: Write tests** — verify free=25, earned_free=50, pro/team=Infinity.

**Step 2: Implement `src/api/lib/plan-limits.ts`** — `getPlanLimits(plan)` returns `{ maxConcepts }`.

**Step 3: Add plan check** to observe endpoint in `src/api/routes/mcp.ts` — query subscription, count user concepts, reject with 403 and upgradeUrl if over limit.

**Step 4: Run tests, commit**

---

## Task 13: Earned Free Evaluation

**Files:**
- Create: `src/api/lib/earned-free.ts`
- Create: `tests/api/earned-free.test.ts`
- Modify: `src/api/routes/mcp.ts`

**Step 1: Write tests** — grants when 80%+ mastered, denies below threshold, requires min 10 concepts.

**Step 2: Implement `shouldGrantEarnedFree()` and `getEarnedFreeExpiry()` (2 weeks).**

**Step 3: Wire into record-evaluation** — after Bayesian update, check if free user qualifies. If yes, upsert subscription as earned_free with expiry, send congratulatory email.

**Step 4: Run tests, commit**

---

## Task 14: SVG Sparkline Generator

**Files:**
- Create: `src/api/lib/sparkline.ts`
- Create: `tests/api/sparkline.test.ts`

**Step 1: Write tests** — valid SVG output, handles single point, handles empty.

**Step 2: Implement `generateSparklineSvg(data, options)`** — inline SVG with polyline, fill polygon, data point circles, y-axis labels.

**Step 3: Run tests, commit**

---

## Task 15: Mastery Summary Cron Job

**Files:**
- Create: `src/api/jobs/mastery-summary.ts`
- Modify: `src/api/worker.ts`
- Modify: `wrangler.toml`

**Step 1: Implement `runMasterySummaryJob(db)`** — query users with prefs != off, build sparkline from recent events, calculate improved/decayed concepts, send email.

**Step 2: Add `scheduled` handler** to worker.ts default export.

**Step 3: Add cron trigger** to wrangler.toml: `crons = ["0 8 * * 1"]` (Monday 8AM UTC).

**Step 4: Run tests, commit**

---

## Task 16: Dashboard — Billing UI

**Files:**
- Modify: `src/api/routes/dashboard.ts`

**Step 1: Add billing section** to settings tab — current plan display, upgrade button (redirects to Stripe Checkout), earned free progress.

**Step 2: Manual test, commit**

---

## Task 17: Email Preferences UI

**Files:**
- Create: `src/api/routes/preferences.ts`
- Modify: `src/api/index.ts`
- Modify: `src/api/routes/dashboard.ts`

**Step 1: Implement preferences API** — GET/PUT `/api/preferences` with upsert on emailPreferences table.

**Step 2: Mount** at `/api/preferences` in index.ts.

**Step 3: Add preferences UI** to settings tab — frequency dropdown (weekly/biweekly/monthly/off), transactional toggle.

**Step 4: Commit**

---

## Task 18: Auto-Accept Invitations on Sign-Up

**Files:**
- Modify: `src/api/lib/auth.ts`

**Step 1: Verify** Better Auth org plugin auto-accepts invitations on matching email sign-up. If not, add `databaseHooks.user.create.after` to check and accept.

**Step 2: Manual test** — invite email, sign up, verify org membership.

**Step 3: Commit**

---

## Task 19: Deploy & Smoke Test

**Step 1: Set Cloudflare Workers secrets** via `npx wrangler secret put`.

**Step 2: Push schema** — `npm run db:push`.

**Step 3: Deploy** — `npx wrangler deploy`.

**Step 4: Smoke test checklist:**
- [ ] Health check OK
- [ ] Dashboard loads with social login buttons
- [ ] Email/password sign-up
- [ ] API key generate + copy
- [ ] Device code flow
- [ ] Stripe checkout redirect
- [ ] Org create + invite
- [ ] Cron trigger registered

---

## Dependency Graph

```
Task 1 (schema) ──┬── Task 2 (social login) ── Task 3 (login buttons) ──┐
                   ├── Task 4 (API key UI)                                │
                   ├── Task 5 (device code API) ─┬── Task 6 (link page) ──┤
                   │                             └── Task 7 (MCP tool)    │
                   ├── Task 11 (Stripe) ─┬── Task 12 (plan limits)        │
                   │                     └── Task 16 (billing UI)         │
                   │                                                      │
Task 8 (email) ───┬── Task 9 (org invite) ─┬── Task 10 (org UI)          │
                   │                        └── Task 18 (auto-accept)     │
                   ├── Task 13 (earned free) ◄── Task 12                  │
                   ├── Task 17 (email prefs)                              │
                   │                                                      │
Task 14 (sparkline)┴── Task 15 (cron job) ◄── Task 8                     │
                                                                          │
                                               Task 19 (deploy) ◄────────┘
```

**Parallelizable groups:**
- Group A: Tasks 1-7 (auth + device code)
- Group B: Tasks 8, 14 (email + sparkline — no schema dependency)
- Group C: Tasks 11-13, 16 (billing — needs Task 1)
- Group D: Tasks 9-10, 17-18 (org + prefs — needs Task 8)
- Group E: Task 15 (cron — needs Tasks 8 + 14)
- Final: Task 19 (deploy — needs all)
