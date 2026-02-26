# Security, Integrity & Course Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Entendi's evaluation pipeline tamper-resistant via challenge-response probe tokens, add dismiss tracking, statistical anomaly detection, evaluation prompt hardening, and course syllabus alignment.

**Architecture:** Server issues signed probe tokens when `observe` decides to probe. `record-evaluation` rejects scores without valid tokens. Dismiss events are tracked. Anomaly detection uses z-scores against user history and population baselines. Courses are created via API with LLM-powered syllabus extraction.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Neon PostgreSQL, Vitest, `crypto` (Node built-in for HMAC), Zod

---

### Task 1: Probe Token Crypto Utilities

**Files:**
- Create: `src/core/probe-token.ts`
- Test: `tests/core/probe-token.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/core/probe-token.test.ts
import { describe, it, expect } from 'vitest';
import { createProbeToken, verifyProbeToken } from '../../src/core/probe-token.js';

const SECRET = 'test-secret-at-least-32-characters-long-for-hmac';

describe('probe-token', () => {
  describe('createProbeToken', () => {
    it('creates a token with all required fields', () => {
      const token = createProbeToken({
        userId: 'user-1',
        conceptId: 'redis',
        depth: 2,
        evaluationCriteria: 'Must mention persistence tradeoffs',
        secret: SECRET,
        ttlMs: 30 * 60 * 1000,
      });
      expect(token.tokenId).toBeDefined();
      expect(token.userId).toBe('user-1');
      expect(token.conceptId).toBe('redis');
      expect(token.depth).toBe(2);
      expect(token.evaluationCriteria).toBe('Must mention persistence tradeoffs');
      expect(token.signature).toBeDefined();
      expect(typeof token.signature).toBe('string');
      expect(new Date(token.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('verifyProbeToken', () => {
    it('accepts a valid token', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      const result = verifyProbeToken(token, SECRET);
      expect(result.valid).toBe(true);
    });

    it('rejects a token with tampered signature', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      token.signature = 'tampered';
      const result = verifyProbeToken(token, SECRET);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_signature');
    });

    it('rejects a token with tampered conceptId', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      token.conceptId = 'hacked';
      const result = verifyProbeToken(token, SECRET);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_signature');
    });

    it('rejects an expired token', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: -1000, // already expired
      });
      const result = verifyProbeToken(token, SECRET);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('rejects a token signed with wrong secret', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      const result = verifyProbeToken(token, 'wrong-secret-that-is-also-long-enough');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_signature');
    });

    it('validates userId matches', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      const result = verifyProbeToken(token, SECRET, { userId: 'user-2' });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('user_mismatch');
    });

    it('validates conceptId matches', () => {
      const token = createProbeToken({
        userId: 'user-1', conceptId: 'redis', depth: 2,
        evaluationCriteria: '', secret: SECRET, ttlMs: 30 * 60 * 1000,
      });
      const result = verifyProbeToken(token, SECRET, { conceptId: 'mongodb' });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('concept_mismatch');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/probe-token.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/core/probe-token.ts
import { createHmac, randomUUID } from 'crypto';

export interface ProbeToken {
  tokenId: string;
  userId: string;
  conceptId: string;
  depth: number;
  evaluationCriteria: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface CreateProbeTokenInput {
  userId: string;
  conceptId: string;
  depth: number;
  evaluationCriteria: string;
  secret: string;
  ttlMs: number;
}

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: 'invalid_signature' | 'expired' | 'user_mismatch' | 'concept_mismatch' };

function computeSignature(token: Omit<ProbeToken, 'signature'>, secret: string): string {
  const payload = `${token.tokenId}:${token.userId}:${token.conceptId}:${token.depth}:${token.issuedAt}:${token.expiresAt}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createProbeToken(input: CreateProbeTokenInput): ProbeToken {
  const now = new Date();
  const tokenData = {
    tokenId: randomUUID(),
    userId: input.userId,
    conceptId: input.conceptId,
    depth: input.depth,
    evaluationCriteria: input.evaluationCriteria,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
  };
  return { ...tokenData, signature: computeSignature(tokenData, input.secret) };
}

export function verifyProbeToken(
  token: ProbeToken,
  secret: string,
  constraints?: { userId?: string; conceptId?: string },
): VerifyResult {
  // 1. Check signature
  const expected = computeSignature(token, secret);
  if (token.signature !== expected) {
    return { valid: false, reason: 'invalid_signature' };
  }
  // 2. Check expiry
  if (new Date(token.expiresAt).getTime() <= Date.now()) {
    return { valid: false, reason: 'expired' };
  }
  // 3. Check userId
  if (constraints?.userId && token.userId !== constraints.userId) {
    return { valid: false, reason: 'user_mismatch' };
  }
  // 4. Check conceptId
  if (constraints?.conceptId && token.conceptId !== constraints.conceptId) {
    return { valid: false, reason: 'concept_mismatch' };
  }
  return { valid: true };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/probe-token.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Commit**

```bash
git add src/core/probe-token.ts tests/core/probe-token.test.ts
git commit -m "feat: add HMAC-signed probe token creation and verification"
```

---

### Task 2: Database Schema — Probe Tokens, Dismissal Events, Anomaly Scores

**Files:**
- Modify: `src/api/db/schema.ts`
- Test: `tests/api/db/schema.test.ts` (existing — verify schema compiles)

**Step 1: Add new tables to schema**

Add these tables after the existing `pendingActions` table in `src/api/db/schema.ts`:

```typescript
// --- Probe Tokens ---
export const probeTokens = pgTable('probe_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  depth: smallint('depth').notNull(),
  evaluationCriteria: text('evaluation_criteria').notNull().default(''),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  signature: text('signature').notNull(),
}, (table) => [
  index('idx_probe_tokens_user').on(table.userId),
]);

// --- Dismissal Events ---
export const dismissalEvents = pgTable('dismissal_events', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  probeTokenId: text('probe_token_id').references(() => probeTokens.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_dismissal_events_user_concept').on(table.userId, table.conceptId),
]);

// --- Anomaly Scores ---
export const anomalyScores = pgTable('anomaly_scores', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  zSelf: real('z_self').notNull().default(0),
  zPopulation: real('z_population').notNull().default(0),
  dismissRatio: real('dismiss_ratio').notNull().default(0),
  masteryVelocity: real('mastery_velocity').notNull().default(0),
  compositeScore: real('composite_score').notNull().default(0),
  signals: jsonb('signals').notNull().default({}),
}, (table) => [
  index('idx_anomaly_scores_user').on(table.userId),
]);

// --- Courses ---
export const courses = pgTable('courses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  orgId: text('org_id').references(() => organization.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const courseModules = pgTable('course_modules', {
  id: text('id').primaryKey(),
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
});

export const courseConcepts = pgTable('course_concepts', {
  id: serial('id').primaryKey(),
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  moduleId: text('module_id').references(() => courseModules.id, { onDelete: 'set null' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  learningObjective: text('learning_objective'),
  requiredMasteryThreshold: real('required_mastery_threshold').notNull().default(0.7),
}, (table) => [
  index('idx_course_concepts_course').on(table.courseId),
]);

export const courseEnrollments = pgTable('course_enrollments', {
  id: serial('id').primaryKey(),
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('active'),
}, (table) => [
  index('idx_course_enrollments_user').on(table.userId),
]);
```

**Step 2: Add new columns to existing tables**

In the `assessmentEvents` table, add after `tutored`:

```typescript
  probeTokenId: text('probe_token_id'),
  responseText: text('response_text'),
  evaluationCriteria: text('evaluation_criteria'),
```

In the `tutorSessions` table, add after `lastMisconception`:

```typescript
  researchPerformed: boolean('research_performed').notNull().default(false),
  sources: text('sources').array().notNull().default([]),
```

In the `pendingActions` table, add after `data`:

```typescript
  probeTokenId: text('probe_token_id'),
```

**Step 3: Generate and run migration**

Run: `npx drizzle-kit generate`
Then: `npx tsx src/api/db/migrate.ts`

**Step 4: Verify existing schema tests still pass**

Run: `npx vitest run tests/api/db/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/db/schema.ts drizzle/
git commit -m "feat: add probe_tokens, dismissal_events, anomaly_scores, courses tables"
```

---

### Task 3: Wire Probe Tokens Into Observe Endpoint

**Files:**
- Modify: `src/api/routes/mcp.ts` (observe handler)

**Step 1: Write the failing test**

```typescript
// tests/api/routes/mcp-tokens.test.ts
import { config } from 'dotenv';
config();
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const testApiKey = process.env.ENTENDI_API_KEY;
const describeWithDb = testDbUrl && testApiKey ? describe : describe.skip;

describeWithDb('MCP observe returns probe token', () => {
  const { app } = createApp(testDbUrl!, { secret: 'test-secret-that-is-at-least-32-chars-long-yep' });

  it('observe response includes probeToken when shouldProbe is true', async () => {
    // Observe a novel concept that should trigger probing
    const res = await app.request('/api/mcp/observe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': testApiKey!,
      },
      body: JSON.stringify({
        concepts: [{ id: 'test-novel-concept-' + Date.now(), source: 'llm' }],
        triggerContext: 'testing probe tokens',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // If shouldProbe is true, token must be present
    if (body.shouldProbe) {
      expect(body.probeToken).toBeDefined();
      expect(body.probeToken.tokenId).toBeDefined();
      expect(body.probeToken.signature).toBeDefined();
      expect(body.probeToken.conceptId).toBeDefined();
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/routes/mcp-tokens.test.ts`
Expected: FAIL — probeToken not in response

**Step 3: Modify observe endpoint**

In `src/api/routes/mcp.ts`:

1. Import `createProbeToken` from `../../core/probe-token.js`
2. After `import type { Env } from '../index.js'`, add:
   ```typescript
   const PROBE_TOKEN_SECRET = process.env.BETTER_AUTH_SECRET ?? 'entendi-default-secret-change-in-production';
   const PROBE_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
   ```
3. In the observe handler, after writing the pending action (line ~259), generate a probe token:
   ```typescript
   const probeToken = createProbeToken({
     userId: user.id,
     conceptId: selected.conceptId,
     depth,
     evaluationCriteria: guidance,
     secret: PROBE_TOKEN_SECRET,
     ttlMs: PROBE_TOKEN_TTL_MS,
   });

   // Store token in DB
   await db.insert(probeTokens).values({
     id: probeToken.tokenId,
     userId: user.id,
     conceptId: selected.conceptId,
     depth,
     evaluationCriteria: guidance,
     expiresAt: new Date(probeToken.expiresAt),
     signature: probeToken.signature,
   });

   // Store token ID in pending action
   await db.update(pendingActions).set({
     probeTokenId: probeToken.tokenId,
   }).where(eq(pendingActions.userId, user.id));
   ```
4. Add `probeToken` to the response JSON object

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/routes/mcp-tokens.test.ts`
Expected: PASS

**Step 5: Run all tests to verify no regressions**

Run: `npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/api/routes/mcp.ts tests/api/routes/mcp-tokens.test.ts
git commit -m "feat: observe endpoint issues signed probe tokens"
```

---

### Task 4: Validate Probe Tokens in record-evaluation

**Files:**
- Modify: `src/api/routes/mcp.ts` (record-evaluation handler)

**Step 1: Write the failing test**

```typescript
// tests/api/routes/mcp-record-eval.test.ts
import { config } from 'dotenv';
config();
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const testApiKey = process.env.ENTENDI_API_KEY;
const describeWithDb = testDbUrl && testApiKey ? describe : describe.skip;

describeWithDb('MCP record-evaluation token validation', () => {
  const { app } = createApp(testDbUrl!, { secret: 'test-secret-that-is-at-least-32-chars-long-yep' });
  const headers = { 'Content-Type': 'application/json', 'x-api-key': testApiKey! };

  it('rejects record-evaluation without probeToken', async () => {
    const res = await app.request('/api/mcp/record-evaluation', {
      method: 'POST', headers,
      body: JSON.stringify({
        conceptId: 'redis',
        score: 3, confidence: 0.9,
        reasoning: 'I know redis', eventType: 'probe',
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain('token');
  });

  it('rejects record-evaluation with invalid signature', async () => {
    const res = await app.request('/api/mcp/record-evaluation', {
      method: 'POST', headers,
      body: JSON.stringify({
        conceptId: 'redis',
        score: 3, confidence: 0.9,
        reasoning: 'I know redis', eventType: 'probe',
        probeToken: {
          tokenId: 'fake', userId: 'fake', conceptId: 'redis',
          depth: 1, evaluationCriteria: '', issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(), signature: 'bad',
        },
        responseText: 'my response',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects record-evaluation without responseText', async () => {
    // First get a valid token via observe
    const observeRes = await app.request('/api/mcp/observe', {
      method: 'POST', headers,
      body: JSON.stringify({
        concepts: [{ id: 'test-eval-concept-' + Date.now(), source: 'llm' }],
        triggerContext: 'testing',
      }),
    });
    const observed = await observeRes.json() as any;
    if (!observed.shouldProbe) return; // skip if no probe triggered

    const res = await app.request('/api/mcp/record-evaluation', {
      method: 'POST', headers,
      body: JSON.stringify({
        conceptId: observed.probeToken.conceptId,
        score: 2, confidence: 0.8,
        reasoning: 'decent answer', eventType: 'probe',
        probeToken: observed.probeToken,
        // responseText intentionally missing
      }),
    });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/routes/mcp-record-eval.test.ts`
Expected: FAIL — currently accepts without token

**Step 3: Modify record-evaluation endpoint**

In `src/api/routes/mcp.ts`:

1. Import `verifyProbeToken, type ProbeToken` from `../../core/probe-token.js`
2. Update `recordEvaluationSchema` to include new fields:
   ```typescript
   const recordEvaluationSchema = z.object({
     conceptId: z.string().min(1).max(200),
     score: z.number().int().min(0).max(3) as z.ZodType<0 | 1 | 2 | 3>,
     confidence: z.number().min(0).max(1),
     reasoning: z.string().max(2000),
     eventType: z.enum(['probe', 'tutor_phase1', 'tutor_phase4']),
     probeToken: z.object({
       tokenId: z.string(),
       userId: z.string(),
       conceptId: z.string(),
       depth: z.number(),
       evaluationCriteria: z.string(),
       issuedAt: z.string(),
       expiresAt: z.string(),
       signature: z.string(),
     }).optional(),
     responseText: z.string().min(1).max(10000).optional(),
   });
   ```
3. In the record-evaluation handler, before the Bayesian update:
   ```typescript
   // For probe events, require a valid probe token
   if (body.eventType === 'probe') {
     if (!body.probeToken) {
       return c.json({ error: 'Probe token required for probe evaluations' }, 403);
     }
     if (!body.responseText) {
       return c.json({ error: 'Response text required for probe evaluations' }, 400);
     }

     const verification = verifyProbeToken(body.probeToken, PROBE_TOKEN_SECRET, {
       userId: user.id,
       conceptId: body.conceptId,
     });
     if (!verification.valid) {
       return c.json({ error: `Invalid probe token: ${verification.reason}` }, 403);
     }

     // Check token not already used
     const [existingToken] = await db.select().from(probeTokens)
       .where(eq(probeTokens.id, body.probeToken.tokenId));
     if (!existingToken) {
       return c.json({ error: 'Invalid probe token: not found' }, 403);
     }
     if (existingToken.usedAt) {
       return c.json({ error: 'Invalid probe token: already used' }, 403);
     }

     // Check per-concept rate limit (1 eval per concept per 24h)
     const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
     const [recentEval] = await db.select({ id: assessmentEvents.id }).from(assessmentEvents)
       .where(and(
         eq(assessmentEvents.userId, user.id),
         eq(assessmentEvents.conceptId, body.conceptId),
         eq(assessmentEvents.eventType, 'probe'),
         sql`${assessmentEvents.createdAt} > ${oneDayAgo}`,
       )).limit(1);
     if (recentEval) {
       return c.json({ error: 'Rate limit: only 1 probe evaluation per concept per 24 hours' }, 429);
     }

     // Mark token as used
     await db.update(probeTokens).set({ usedAt: new Date() })
       .where(eq(probeTokens.id, body.probeToken.tokenId));
   }
   ```
4. Pass `probeTokenId` and `responseText` to `applyBayesianUpdateDb` and store in `assessmentEvents`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/routes/mcp-record-eval.test.ts`
Expected: PASS

**Step 5: Run all tests**

Run: `npx vitest run`
Expected: All PASS (update any existing tests that call record-evaluation without a token — they should use `eventType: 'tutor_phase1'` or mock the token)

**Step 6: Commit**

```bash
git add src/api/routes/mcp.ts tests/api/routes/mcp-record-eval.test.ts
git commit -m "feat: record-evaluation requires valid probe token for probe events"
```

---

### Task 5: Dismiss Tracking

**Files:**
- Modify: `src/api/routes/mcp.ts` (dismiss handler)

**Step 1: Write the failing test**

```typescript
// tests/api/routes/mcp-dismiss.test.ts
import { config } from 'dotenv';
config();
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const testApiKey = process.env.ENTENDI_API_KEY;
const describeWithDb = testDbUrl && testApiKey ? describe : describe.skip;

describeWithDb('MCP dismiss tracking', () => {
  const { app } = createApp(testDbUrl!, { secret: 'test-secret-that-is-at-least-32-chars-long-yep' });
  const headers = { 'Content-Type': 'application/json', 'x-api-key': testApiKey! };

  it('dismiss records a dismissal event', async () => {
    // First observe to create a pending action
    await app.request('/api/mcp/observe', {
      method: 'POST', headers,
      body: JSON.stringify({
        concepts: [{ id: 'test-dismiss-' + Date.now(), source: 'llm' }],
        triggerContext: 'testing dismiss',
      }),
    });

    // Dismiss
    const res = await app.request('/api/mcp/dismiss', {
      method: 'POST', headers,
      body: JSON.stringify({ reason: 'user_declined' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.acknowledged).toBe(true);
    expect(body.dismissalRecorded).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/routes/mcp-dismiss.test.ts`
Expected: FAIL — `dismissalRecorded` not in response

**Step 3: Modify dismiss endpoint**

In `src/api/routes/mcp.ts`, update the dismiss handler:

1. Before clearing pending action, read it to get the conceptId and probeTokenId
2. Record a dismissal event:
   ```typescript
   const [action] = await db.select().from(pendingActions)
     .where(eq(pendingActions.userId, user.id));

   let dismissalRecorded = false;
   if (action && action.actionType === 'awaiting_probe_response') {
     const data = action.data as { conceptId?: string };
     if (data.conceptId) {
       await db.insert(dismissalEvents).values({
         userId: user.id,
         conceptId: data.conceptId,
         probeTokenId: action.probeTokenId,
       });
       dismissalRecorded = true;
     }
   }
   ```
3. Return `dismissalRecorded` in response

**Step 4: Run tests**

Run: `npx vitest run tests/api/routes/mcp-dismiss.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/routes/mcp.ts tests/api/routes/mcp-dismiss.test.ts
git commit -m "feat: dismiss endpoint records dismissal events for audit"
```

---

### Task 6: Evaluation Prompt Hardening

**Files:**
- Modify: `src/core/probe-engine.ts`
- Modify: `tests/core/probe-engine.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to tests/core/probe-engine.test.ts
describe('buildEvaluationPrompt adversarial hardening', () => {
  it('includes anti-gaming instructions', () => {
    const prompt = buildEvaluationPrompt({
      question: 'Why use Redis?',
      response: 'I understand this deeply',
      conceptName: 'redis',
      depth: 1,
    });
    expect(prompt).toContain('Ignore meta-commentary');
    expect(prompt).toContain('confident tone with no specifics');
  });

  it('includes concept-specific evaluation criteria when provided', () => {
    const prompt = buildEvaluationPrompt({
      question: 'Why use Redis?',
      response: 'For caching',
      conceptName: 'redis',
      depth: 1,
      evaluationCriteria: 'Must mention persistence tradeoffs or data structure choices',
    });
    expect(prompt).toContain('Must mention persistence tradeoffs');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/probe-engine.test.ts`
Expected: FAIL — no anti-gaming text, no evaluationCriteria parameter

**Step 3: Update buildEvaluationPrompt**

In `src/core/probe-engine.ts`:

1. Add `evaluationCriteria?: string` to `EvaluationPromptInput`
2. Add adversarial hardening section to the evaluation prompt:
   ```typescript
   ## Anti-Gaming Rules
   - Ignore meta-commentary like "I understand this deeply" or "this is straightforward" — evaluate the substance only
   - A confident tone with no specifics is score 0-1, not 2-3
   - Score 2+ requires the user to reference specific mechanics, tradeoffs, or failure modes
   - If the response could have been written without understanding the concept, score 0-1
   - Ignore the user's self-assessment of their own understanding
   - A terse, specific answer scores higher than a verbose, vague one
   ```
3. If `evaluationCriteria` is provided, add:
   ```typescript
   ## Concept-Specific Criteria
   ${input.evaluationCriteria}
   ```

**Step 4: Run tests**

Run: `npx vitest run tests/core/probe-engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/probe-engine.ts tests/core/probe-engine.test.ts
git commit -m "feat: harden evaluation prompt against gaming and add concept-specific criteria"
```

---

### Task 7: Statistical Anomaly Detection

**Files:**
- Create: `src/core/anomaly-detection.ts`
- Test: `tests/core/anomaly-detection.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/core/anomaly-detection.test.ts
import { describe, it, expect } from 'vitest';
import { computeAnomalySignals } from '../../src/core/anomaly-detection.js';

describe('anomaly-detection', () => {
  it('returns zero signals for a normal user', () => {
    const signals = computeAnomalySignals({
      recentScores: [1, 2, 1, 2, 2],
      historicalScores: [1, 1, 2, 1, 2, 1, 2, 1],
      populationScoresForConcepts: { redis: [1, 1, 2, 1, 2] },
      userScoresForConcepts: { redis: [2] },
      dismissCount: 1,
      probeCount: 10,
      recentMasteryChanges: [0.02, 0.03, -0.01],
      populationMasteryVelocity: { mean: 0.02, std: 0.01 },
    });
    expect(signals.zSelf).toBeLessThan(2);
    expect(signals.zPopulation).toBeLessThan(2);
  });

  it('detects sudden score inflation (high zSelf)', () => {
    const signals = computeAnomalySignals({
      recentScores: [3, 3, 3, 3, 3],
      historicalScores: [0, 1, 0, 1, 1, 0, 1, 0, 1, 1],
      populationScoresForConcepts: {},
      userScoresForConcepts: {},
      dismissCount: 0,
      probeCount: 15,
      recentMasteryChanges: [],
      populationMasteryVelocity: { mean: 0, std: 1 },
    });
    expect(signals.zSelf).toBeGreaterThan(2);
  });

  it('detects outlier vs population (high zPopulation)', () => {
    const signals = computeAnomalySignals({
      recentScores: [3],
      historicalScores: [3],
      populationScoresForConcepts: { 'mcmc-sampling': [0, 1, 1, 0, 1, 1, 0] },
      userScoresForConcepts: { 'mcmc-sampling': [3] },
      dismissCount: 0,
      probeCount: 1,
      recentMasteryChanges: [],
      populationMasteryVelocity: { mean: 0, std: 1 },
    });
    expect(signals.zPopulation).toBeGreaterThan(1.5);
  });

  it('tracks dismiss ratio', () => {
    const signals = computeAnomalySignals({
      recentScores: [],
      historicalScores: [],
      populationScoresForConcepts: {},
      userScoresForConcepts: {},
      dismissCount: 8,
      probeCount: 10,
      recentMasteryChanges: [],
      populationMasteryVelocity: { mean: 0, std: 1 },
    });
    expect(signals.dismissRatio).toBeCloseTo(0.8);
  });

  it('handles empty data gracefully', () => {
    const signals = computeAnomalySignals({
      recentScores: [],
      historicalScores: [],
      populationScoresForConcepts: {},
      userScoresForConcepts: {},
      dismissCount: 0,
      probeCount: 0,
      recentMasteryChanges: [],
      populationMasteryVelocity: { mean: 0, std: 1 },
    });
    expect(signals.zSelf).toBe(0);
    expect(signals.zPopulation).toBe(0);
    expect(signals.dismissRatio).toBe(0);
    expect(signals.compositeScore).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/core/anomaly-detection.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/core/anomaly-detection.ts

export interface AnomalyInput {
  recentScores: number[];         // last N probe scores for this user
  historicalScores: number[];     // all-time probe scores for this user
  populationScoresForConcepts: Record<string, number[]>; // concept -> all users' scores
  userScoresForConcepts: Record<string, number[]>;       // concept -> this user's scores
  dismissCount: number;
  probeCount: number;
  recentMasteryChanges: number[]; // delta pMastery per assessment
  populationMasteryVelocity: { mean: number; std: number };
}

export interface AnomalySignals {
  zSelf: number;
  zPopulation: number;
  dismissRatio: number;
  masteryVelocity: number;
  compositeScore: number;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1));
}

export function computeAnomalySignals(input: AnomalyInput): AnomalySignals {
  // z_self: recent scores vs historical baseline
  let zSelf = 0;
  if (input.historicalScores.length >= 3 && input.recentScores.length >= 1) {
    const histMean = mean(input.historicalScores);
    const histStd = std(input.historicalScores);
    if (histStd > 0) {
      zSelf = (mean(input.recentScores) - histMean) / histStd;
    }
  }

  // z_population: user's concept scores vs population scores
  let zPopulation = 0;
  const conceptZScores: number[] = [];
  for (const [conceptId, userScores] of Object.entries(input.userScoresForConcepts)) {
    const popScores = input.populationScoresForConcepts[conceptId];
    if (popScores && popScores.length >= 3 && userScores.length >= 1) {
      const popMean = mean(popScores);
      const popStd = std(popScores);
      if (popStd > 0) {
        conceptZScores.push((mean(userScores) - popMean) / popStd);
      }
    }
  }
  if (conceptZScores.length > 0) {
    zPopulation = mean(conceptZScores);
  }

  // dismiss ratio
  const dismissRatio = input.probeCount > 0
    ? input.dismissCount / input.probeCount
    : 0;

  // mastery velocity z-score
  let masteryVelocity = 0;
  if (input.recentMasteryChanges.length > 0 && input.populationMasteryVelocity.std > 0) {
    const userVelocity = mean(input.recentMasteryChanges);
    masteryVelocity = (userVelocity - input.populationMasteryVelocity.mean)
      / input.populationMasteryVelocity.std;
  }

  // composite: weighted combination (all positive = more suspicious)
  const compositeScore = Math.max(0,
    0.3 * Math.max(0, zSelf) +
    0.3 * Math.max(0, zPopulation) +
    0.2 * dismissRatio +
    0.2 * Math.max(0, masteryVelocity)
  );

  return { zSelf, zPopulation, dismissRatio, masteryVelocity, compositeScore };
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/core/anomaly-detection.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/anomaly-detection.ts tests/core/anomaly-detection.test.ts
git commit -m "feat: statistical anomaly detection with z-scores and dismiss tracking"
```

---

### Task 8: MCP Client & Server — Pass Probe Tokens Through

**Files:**
- Modify: `src/mcp/api-client.ts`
- Modify: `src/mcp/server.ts`

**Step 1: Update EntendiApiClient**

Add `probeToken` and `responseText` to the `recordEvaluation` method signature:

```typescript
async recordEvaluation(input: {
  conceptId: string;
  score: 0 | 1 | 2 | 3;
  confidence: number;
  reasoning: string;
  eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
  probeToken?: {
    tokenId: string; userId: string; conceptId: string;
    depth: number; evaluationCriteria: string;
    issuedAt: string; expiresAt: string; signature: string;
  };
  responseText?: string;
}) {
  return this.request('POST', '/api/mcp/record-evaluation', input);
}
```

**Step 2: Update MCP server tool**

In `src/mcp/server.ts`, update `entendi_record_evaluation` tool:

1. Add `probeToken` and `responseText` to the Zod schema:
   ```typescript
   probeToken: z.object({
     tokenId: z.string(),
     userId: z.string(),
     conceptId: z.string(),
     depth: z.coerce.number(),
     evaluationCriteria: z.string(),
     issuedAt: z.string(),
     expiresAt: z.string(),
     signature: z.string(),
   }).optional(),
   responseText: z.string().optional(),
   ```
2. Pass them through to `api.recordEvaluation`

**Step 3: Update observe tool to return probeToken**

The observe tool already returns the full API response. Verify the probeToken flows through by checking `api.observe()` return type includes it.

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/mcp/api-client.ts src/mcp/server.ts
git commit -m "feat: MCP client and server pass probe tokens through"
```

---

### Task 9: Update Concept Detection Skill

**Files:**
- Modify: `plugin/skills/concept-detection/SKILL.md`

**Step 1: Update the skill with probe token awareness and parallel probing**

Key changes to the SKILL.md:

1. **Probe token handling**: After `entendi_observe` returns `shouldProbe: true`, the response now includes a `probeToken`. When calling `entendi_record_evaluation`, pass through the `probeToken` and include the user's raw response as `responseText`.

2. **Parallel probing**: When a probe is pending AND the user has asked for multi-step implementation work, spawn the work as a background agent and use the main thread for the probe conversation.

3. **Evaluation rigor**: Score responses strictly per the rubric. A confident tone without specifics is 0-1. Meta-commentary like "I understand this deeply" is ignored.

**Step 2: Update the concept-detection skill preamble in the session-start hook**

The session-start hook at `plugin/hooks/session-start` injects this skill. Verify it still references the correct SKILL.md path.

**Step 3: No automated test needed — this is prompt content**

Verify manually by running `claude` with the plugin active.

**Step 4: Commit**

```bash
git add plugin/skills/concept-detection/SKILL.md
git commit -m "feat: update concept-detection skill for probe tokens and parallel probing"
```

---

### Task 10: Course CRUD API Routes

**Files:**
- Create: `src/api/routes/courses.ts`
- Test: `tests/api/routes/courses.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/api/routes/courses.test.ts
import { config } from 'dotenv';
config();
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const testApiKey = process.env.ENTENDI_API_KEY;
const describeWithDb = testDbUrl && testApiKey ? describe : describe.skip;

describeWithDb('Course CRUD routes', () => {
  const { app } = createApp(testDbUrl!, { secret: 'test-secret-that-is-at-least-32-chars-long-yep' });
  const headers = { 'Content-Type': 'application/json', 'x-api-key': testApiKey! };
  let courseId: string;

  it('POST /api/courses creates a course', async () => {
    const res = await app.request('/api/courses', {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'Test Course', description: 'A test course' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Test Course');
    expect(body.status).toBe('draft');
    courseId = body.id;
  });

  it('GET /api/courses lists courses', async () => {
    const res = await app.request('/api/courses', { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body.length).toBeGreaterThan(0);
  });

  it('GET /api/courses/:id returns course details', async () => {
    const res = await app.request(`/api/courses/${courseId}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(courseId);
  });

  it('POST /api/courses/:id/concepts adds a concept to the course', async () => {
    const res = await app.request(`/api/courses/${courseId}/concepts`, {
      method: 'POST', headers,
      body: JSON.stringify({ conceptId: 'react-hooks', learningObjective: 'Understand hooks lifecycle' }),
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/courses/:id/activate activates the course', async () => {
    const res = await app.request(`/api/courses/${courseId}/activate`, {
      method: 'POST', headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('active');
  });

  it('GET /api/courses requires auth', async () => {
    const res = await app.request('/api/courses');
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/routes/courses.test.ts`
Expected: FAIL — routes don't exist

**Step 3: Create course routes**

```typescript
// src/api/routes/courses.ts
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { courses, courseModules, courseConcepts, courseEnrollments, concepts, userConceptStates } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { pMastery } from '../../schemas/types.js';
import type { Env } from '../index.js';

export const courseRoutes = new Hono<Env>();
courseRoutes.use('*', requireAuth);

const createCourseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  orgId: z.string().optional(),
});

const addConceptSchema = z.object({
  conceptId: z.string().min(1).max(200),
  moduleId: z.string().optional(),
  learningObjective: z.string().max(1000).optional(),
  requiredMasteryThreshold: z.number().min(0).max(1).default(0.7),
});

// POST / — create course
courseRoutes.post('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const body = createCourseSchema.parse(await c.req.json());
  const id = crypto.randomUUID();

  await db.insert(courses).values({
    id,
    name: body.name,
    description: body.description,
    ownerId: user.id,
    orgId: body.orgId ?? null,
  });

  return c.json({ id, name: body.name, description: body.description, status: 'draft' }, 201);
});

// GET / — list courses
courseRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const rows = await db.select().from(courses).where(eq(courses.ownerId, user.id));
  return c.json(rows);
});

// GET /:id — course details with concepts
courseRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const [course] = await db.select().from(courses).where(eq(courses.id, id));
  if (!course) return c.json({ error: 'Course not found' }, 404);

  const conceptList = await db.select().from(courseConcepts)
    .where(eq(courseConcepts.courseId, id));
  const modules = await db.select().from(courseModules)
    .where(eq(courseModules.courseId, id));

  return c.json({ ...course, concepts: conceptList, modules });
});

// POST /:id/concepts — add concept to course
courseRoutes.post('/:id/concepts', async (c) => {
  const db = c.get('db');
  const courseId = c.req.param('id');
  const body = addConceptSchema.parse(await c.req.json());

  // Verify course exists
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return c.json({ error: 'Course not found' }, 404);

  // Verify concept exists
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, body.conceptId));
  if (!concept) return c.json({ error: 'Concept not found' }, 404);

  await db.insert(courseConcepts).values({
    courseId,
    conceptId: body.conceptId,
    moduleId: body.moduleId ?? null,
    learningObjective: body.learningObjective ?? null,
    requiredMasteryThreshold: body.requiredMasteryThreshold,
  });

  return c.json({ courseId, conceptId: body.conceptId }, 201);
});

// POST /:id/activate — activate course
courseRoutes.post('/:id/activate', async (c) => {
  const db = c.get('db');
  const courseId = c.req.param('id');

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return c.json({ error: 'Course not found' }, 404);

  await db.update(courses).set({ status: 'active', updatedAt: new Date() })
    .where(eq(courses.id, courseId));

  return c.json({ id: courseId, status: 'active' });
});

// POST /:id/enroll — enroll student
courseRoutes.post('/:id/enroll', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const courseId = c.req.param('id');

  await db.insert(courseEnrollments).values({
    courseId,
    userId: user.id,
  });

  return c.json({ courseId, userId: user.id, status: 'active' }, 201);
});

// GET /:id/progress/:userId — student progress
courseRoutes.get('/:id/progress/:userId', async (c) => {
  const db = c.get('db');
  const courseId = c.req.param('id');
  const userId = c.req.param('userId');

  const conceptList = await db.select().from(courseConcepts)
    .where(eq(courseConcepts.courseId, courseId));

  const progress = await Promise.all(conceptList.map(async (cc) => {
    const [ucs] = await db.select().from(userConceptStates)
      .where(and(eq(userConceptStates.userId, userId), eq(userConceptStates.conceptId, cc.conceptId)));
    const mastery = ucs ? pMastery(ucs.mu) : 0;
    return {
      conceptId: cc.conceptId,
      mastery,
      threshold: cc.requiredMasteryThreshold,
      met: mastery >= cc.requiredMasteryThreshold,
      learningObjective: cc.learningObjective,
    };
  }));

  const metCount = progress.filter(p => p.met).length;

  return c.json({
    courseId, userId,
    progress,
    summary: { total: progress.length, met: metCount, completion: progress.length > 0 ? metCount / progress.length : 0 },
  });
});
```

**Step 4: Wire routes into the app**

In `src/api/index.ts`, add:
```typescript
import { courseRoutes } from './routes/courses.js';
// ...
app.route('/api/courses', courseRoutes);
```

**Step 5: Run tests**

Run: `npx vitest run tests/api/routes/courses.test.ts`
Expected: PASS

**Step 6: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/api/routes/courses.ts src/api/index.ts tests/api/routes/courses.test.ts
git commit -m "feat: course CRUD API with concept mapping and progress tracking"
```

---

### Task 11: Tutor Session Research Fields

**Files:**
- Modify: `src/api/routes/mcp.ts` (tutor/start handler)
- Modify: `plugin/skills/concept-detection/SKILL.md`

**Step 1: Update tutor/start to accept research fields**

Add to `tutorStartSchema`:
```typescript
researchPerformed: z.boolean().default(false),
sources: z.array(z.string()).default([]),
```

In the tutor/start handler, store these in the tutor session:
```typescript
await db.insert(tutorSessions).values({
  // ... existing fields
  researchPerformed: body.researchPerformed,
  sources: body.sources,
});
```

**Step 2: Update concept-detection skill**

Add tutor research instructions to SKILL.md — when starting a tutor session, Claude should:
1. Self-evaluate knowledge of the concept
2. If uncertain, use web search or Context7 to research
3. Pass `researchPerformed: true` and `sources: [...]` to `entendi_start_tutor`

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/api/routes/mcp.ts plugin/skills/concept-detection/SKILL.md
git commit -m "feat: tutor sessions track research performed and sources"
```

---

### Task 12: Build, Deploy, Verify

**Step 1: Build**

Run: `npm run build`
Expected: Clean build with no errors

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 3: Generate migration for new tables**

Run: `npx drizzle-kit generate`
Then: `npx tsx src/api/db/migrate.ts`

**Step 4: Deploy to Cloudflare Workers**

Run: `npx wrangler deploy`

**Step 5: Smoke test production**

```bash
# Health check
curl https://entendi-api.tomaskorenblit.workers.dev/health

# Observe (should return probeToken)
curl -X POST https://entendi-api.tomaskorenblit.workers.dev/api/mcp/observe \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ENTENDI_API_KEY" \
  -d '{"concepts":[{"id":"test-deploy","source":"llm"}],"triggerContext":"smoke test"}'

# Verify record-evaluation rejects without token
curl -X POST https://entendi-api.tomaskorenblit.workers.dev/api/mcp/record-evaluation \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ENTENDI_API_KEY" \
  -d '{"conceptId":"test","score":3,"confidence":0.9,"reasoning":"test","eventType":"probe"}'
# Expected: 403
```

**Step 6: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: build, migrate, and deploy v0.3 security hardening"
```

---

## Execution Dependencies

```
Task 1 (probe tokens)     ──┐
Task 2 (schema)           ──┼── Task 3 (observe) ── Task 4 (record-eval) ── Task 5 (dismiss)
                            │
Task 6 (eval hardening)   ──┘
Task 7 (anomaly detection) ── independent
Task 8 (MCP passthrough)  ── depends on Task 3, 4
Task 9 (skill update)     ── depends on Task 8
Task 10 (courses)         ── depends on Task 2
Task 11 (tutor research)  ── depends on Task 2
Task 12 (build & deploy)  ── depends on all
```

Tasks 1, 2, 6, 7, 10 can be parallelized. Tasks 3→4→5→8→9 are sequential.
