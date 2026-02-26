# Auth, Onboarding, Billing & Email Design

**Date:** 2026-02-26
**Status:** Draft

## Problem

Users who install the Entendi plugin have no way to:
1. Create an account and link it to their CLI
2. See their mastery data in the dashboard
3. Join or manage an organization
4. Pay for extended usage

The current setup has a single hardcoded API key and test credentials. We need a real onboarding flow, org model, billing, and email.

## Overview

| Component | Tool | Notes |
|-----------|------|-------|
| Auth | Better Auth | Add GitHub + Google OAuth to existing email/password |
| API Keys | Better Auth plugin | Already in schema, needs dashboard UI + generation flow |
| Device Code | Custom (Neon) | CLI-first linking via polling |
| Orgs | Better Auth org plugin | Already in schema, needs dashboard UI + invite flow |
| Billing | Stripe | Free tier with mastery-based unlocks, tiered org pricing |
| Email | Resend | Transactional (invites, key generation) + periodic (mastery summaries) |

## 1. Social Login

Add GitHub and Google OAuth to Better Auth config.

### Auth Config

```ts
socialProviders: {
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
}
```

Better Auth auto-handles:
- OAuth callbacks at `/api/auth/callback/github` and `/api/auth/callback/google`
- Account linking when emails match across providers
- The existing `account` table already supports multiple providers (`providerId` field)

### Dashboard Login Page

Three sign-in options side by side:
- "Sign in with GitHub" button
- "Sign in with Google" button
- Email/password form (existing)

### Environment Variables

```
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## 2. API Key Management (Dashboard-First Flow)

After login, the dashboard gets a **Settings** tab with API key management.

### UI

- **Generate API Key** button → calls `POST /api/keys` (Better Auth built-in)
- Key shown **once** on creation with "Copy to clipboard" button
- Existing keys listed (masked: `entendi_abc...xyz`) with revoke button
- Instructions below: "Run: `claude plugin configure entendi --env ENTENDI_API_KEY=<key>`"

### API

Better Auth's apiKey plugin already provides:
- `POST /api/keys` — create key (returns full key once)
- `GET /api/keys` — list keys (masked)
- `DELETE /api/keys/:id` — revoke key

No custom endpoints needed.

## 3. Device Code Flow (CLI-First Flow)

For pro users who want a seamless CLI experience.

### New Table

```sql
CREATE TABLE device_codes (
  code TEXT PRIMARY KEY,              -- 8-char alphanumeric (e.g., "ABCD1234")
  user_id TEXT REFERENCES "user"(id), -- null until confirmed
  api_key TEXT,                       -- full key, null until confirmed
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'expired'
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### Flow

```
User runs /login in Claude Code
        │
        ▼
MCP calls POST /api/auth/device-code
        │ Returns: { code: "ABCD1234", verifyUrl: "https://...dashboard/link?code=ABCD1234" }
        │
        ├──► Opens browser to verifyUrl
        │
        └──► Polls GET /api/auth/device-code/ABCD1234 every 2s
                    │
                    ▼
        User signs in on dashboard (GitHub/Google/email)
                    │
                    ▼
        Dashboard shows "Link device ABCD1234?" confirmation page
                    │
                    ▼
        User confirms → API generates API key, updates device_codes row
                    │
                    ▼
        Poll returns { status: "confirmed", apiKey: "entendi_..." }
                    │
                    ▼
        MCP writes key to plugin env config
```

### API Endpoints

- `POST /api/auth/device-code` — create code (no auth required)
  - Response: `{ code, verifyUrl, expiresAt }`
- `GET /api/auth/device-code/:code` — poll status (no auth required)
  - Pending: `{ status: "pending" }`
  - Confirmed: `{ status: "confirmed", apiKey: "..." }`
  - Expired: `{ status: "expired" }`

### MCP Tool

New tool: `entendi_login`
- Creates device code via API
- Opens browser
- Polls until confirmed or expired (10 minute TTL)
- Writes API key to env config
- Returns success message with user info

### Security

- Codes expire after 10 minutes
- Each code is single-use (deleted after confirmation or expiry)
- API key in poll response is only returned once (cleared after first read)
- Rate limit: max 5 device code creations per IP per hour

## 4. Organization Model

### Sign-Up Behavior

On account creation:
1. Check `invitation` table for pending invitations matching user's email
2. If invitation found → auto-accept, user joins that org with the invited role
3. If no invitation → user operates in solo mode (no org). Can create one from dashboard.

### Dashboard: Org Management

**For org owners/admins:**
- Create organization (name, slug, logo)
- Invite members by email → sends invite via Resend
- Member list with roles (owner, admin, member)
- Remove members, change roles

**For all org members:**
- View shared concept library (all members see all concepts)
- Create new concepts (added to shared library)
- Mastery rankings — leaderboard sorted by:
  - Total concepts mastered (mastery > 80%)
  - Average mastery across all concepts
  - Recent improvement (mastery change over last 7/30 days)

**Data visibility within an org:**
- Concepts: shared (any member can create, all members see)
- Mastery levels: visible to all org members (the leaderboard)
- Assessment history (individual probe scores): private to each user

### Invite Flow

```
Admin enters email in dashboard
        │
        ▼
POST /organization/invite (Better Auth built-in)
        │
        ▼
sendInvitationEmail callback fires
        │
        ▼
Resend sends email with invite link: /dashboard/accept-invitation/{invitationId}
        │
        ▼
Recipient clicks link → signs up or signs in → auto-joins org
```

## 5. Billing (Stripe)

### Plan Structure

#### Individuals

| Plan | Price | Limits | How to Unlock |
|------|-------|--------|---------------|
| **Free** | $0 | 25 concepts tracked | Default |
| **Earned Free** | $0 | 50 concepts, extended 2 weeks at a time | Master 20/25 concepts (>80% mastery) |
| **Pro** | ~$5/mo | Unlimited concepts, full history | Pay |

**The "earn more free" mechanic:**
- User masters 80%+ of their tracked concepts → system grants 2 more weeks with doubled concept cap
- Resets if mastery decays below threshold (keeps the learning flywheel going)
- Checked via a scheduled job or on each observe call

#### Organizations

| Plan | Price | Includes |
|------|-------|----------|
| **Team Small** | ~$3/seat/mo | Up to 10 seats, shared concepts, rankings, admin dashboard |
| **Team** | ~$2/seat/mo | 11-50 seats |
| **Enterprise** | Custom | 50+ seats, SSO, dedicated support |

Prices are intentionally low to encourage adoption. Exact numbers TBD — Stripe makes it easy to adjust.

### Stripe Integration

Use Better Auth's Stripe plugin or integrate directly:

- **Products** in Stripe: Individual Pro, Team Small, Team
- **Price objects**: monthly recurring
- **Checkout**: Stripe Checkout Sessions (redirect flow, no custom payment UI)
- **Webhooks**: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
- **Subscription status** stored in a new `subscriptions` table or as user/org metadata

### New Table

```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES "user"(id),          -- for individual plans
  organization_id TEXT REFERENCES organization(id), -- for team plans
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  plan TEXT NOT NULL,                           -- 'pro' | 'team_small' | 'team' | 'enterprise'
  status TEXT NOT NULL,                         -- 'active' | 'past_due' | 'canceled' | 'trialing'
  current_period_end TIMESTAMP NOT NULL,
  seat_count INTEGER,                           -- for team plans
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### Enforcement

- On `POST /api/mcp/observe`: check concept count against plan limit
  - Free: reject if user has 25+ concepts
  - Earned Free: reject if user has 50+ concepts
  - Pro/Team: no limit
- Return clear error: `{ error: "concept_limit_reached", limit: 25, current: 25, upgradeUrl: "..." }`

### Earned Free Evaluation

On each observe call (or daily cron):
1. Count user's concepts with mastery > 80%
2. If mastered >= 80% of tracked concepts AND current plan is Free:
   - Grant "Earned Free" status
   - Set expiry to 2 weeks from now
   - Send congratulatory email via Resend
3. If Earned Free has expired and mastery dropped below threshold:
   - Revert to Free (25 concept cap)
   - Existing concepts above cap are preserved but no new ones tracked

## 6. Email (Resend)

### Transactional Emails

| Trigger | Template | Recipient |
|---------|----------|-----------|
| Org invite | "You've been invited to join {org} on Entendi" | Invitee |
| API key created | "Your Entendi API key is ready" (with setup instructions) | User |
| Device code confirmed | "Device linked successfully" | User |
| Earned Free unlocked | "You earned 2 more weeks of free Entendi!" | User |
| Earned Free expiring | "Your earned free tier expires in 3 days" | User |
| Subscription confirmed | "Welcome to Entendi Pro/Team" | User/Admin |

### Mastery Summary Emails

**For individuals** (weekly, configurable):
- Subject: "Your Entendi mastery this week"
- Content:
  - Mastery evolution sparkline/plot (inline SVG or linked image)
  - Concepts improved (with delta: "react-hooks: 45% → 72%")
  - Concepts that decayed (gentle: "bayesian-statistics could use a refresh")
  - Total concepts mastered vs. tracked
  - Motivational: "You've grown 12% this week"

**For org admins** (weekly, configurable):
- Subject: "{org} team learning report"
- Content:
  - Team-wide stats (total concepts, average mastery, improvement)
  - Top improvers this week (leaderboard delta)
  - New concepts added
  - Members who haven't been probed recently

**Plot generation:**
- Use inline SVG for sparklines (no external image hosting needed)
- Generated server-side from assessment_events history
- Simple line chart: x = time, y = mastery %

### Frequency

- Default: weekly (Monday morning)
- Configurable per user/org: weekly / biweekly / monthly / off
- Stored as user preference (new column or metadata)

### Implementation

```ts
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);
```

Cron job (Cloudflare Workers Cron Triggers) runs weekly:
1. Query users with email preferences != 'off'
2. For each user: query mastery history from last period
3. Generate SVG sparkline
4. Send via Resend

## Environment Variables (Complete)

```
# Existing
DATABASE_URL=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
ENTENDI_API_KEY=

# New: OAuth
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# New: Email
RESEND_API_KEY=re_NfY4Lm6F_Gs5HMsbgwnQakDB3rp6W5sxk

# New: Billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=          # Stripe price ID for individual Pro
STRIPE_PRICE_TEAM_SMALL=   # Stripe price ID for Team Small
STRIPE_PRICE_TEAM=         # Stripe price ID for Team
```

## New Tables Summary

| Table | Purpose |
|-------|---------|
| `device_codes` | CLI-first device code linking flow |
| `subscriptions` | Stripe subscription state |
| `email_preferences` | Per-user/org email frequency setting |

Existing tables used as-is: `user`, `account`, `organization`, `member`, `invitation`, `apikey`.

## Out of Scope

- VS Code extension auth
- Neo4j migration
- SSO / SAML (enterprise tier, future)
- Custom email domains per org
