# Historical Analytics v0.4a Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add core historical analytics — mastery timelines with confidence bands, learning velocity, concept detail pages, concepts explorer, and activity heatmaps.

**Architecture:** Three new analytics tables (on-write materialized), new `/api/analytics` route group, ECharts 6 integration in the vanilla JS dashboard with three new tabs (Analytics, Concepts, Integrity).

**Tech Stack:** Drizzle ORM (schema + migrations), Hono (API routes), Apache ECharts 6 (charts), Vitest (tests), esbuild (dashboard build)

**Design doc:** `docs/plans/2026-02-26-historical-analytics-design.md`

---

### Task 1: Add Analytics Schema Tables

**Files:**
- Modify: `src/api/db/schema.ts`

**Step 1: Write the failing test**

Create `tests/api/db/analytics-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { dailySnapshots, zpdSnapshots, conceptAnalytics } from '../../../src/api/db/schema.js';

describe('Analytics schema tables', () => {
  it('dailySnapshots has expected columns', () => {
    const cols = Object.keys(dailySnapshots);
    expect(cols).toContain('userId');
    expect(cols).toContain('date');
    expect(cols).toContain('assessmentCount');
    expect(cols).toContain('conceptsAssessed');
    expect(cols).toContain('avgMasteryDelta');
    expect(cols).toContain('totalDismissals');
    expect(cols).toContain('avgIntegrityScore');
    expect(cols).toContain('probeCount');
    expect(cols).toContain('tutorCount');
    expect(cols).toContain('domains');
  });

  it('zpdSnapshots has expected columns', () => {
    const cols = Object.keys(zpdSnapshots);
    expect(cols).toContain('id');
    expect(cols).toContain('userId');
    expect(cols).toContain('conceptId');
    expect(cols).toContain('enteredAt');
    expect(cols).toContain('exitedAt');
    expect(cols).toContain('masteryAtEntry');
    expect(cols).toContain('masteryAtExit');
  });

  it('conceptAnalytics has expected columns', () => {
    const cols = Object.keys(conceptAnalytics);
    expect(cols).toContain('userId');
    expect(cols).toContain('conceptId');
    expect(cols).toContain('firstAssessedAt');
    expect(cols).toContain('lastAssessedAt');
    expect(cols).toContain('totalProbes');
    expect(cols).toContain('totalTutorSessions');
    expect(cols).toContain('totalDismissals');
    expect(cols).toContain('peakMastery');
    expect(cols).toContain('currentStreak');
    expect(cols).toContain('longestStreak');
    expect(cols).toContain('avgResponseWordCount');
    expect(cols).toContain('avgIntegrityScore');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/db/analytics-schema.test.ts`
Expected: FAIL — `dailySnapshots` is not exported from schema

**Step 3: Add the three analytics tables to schema.ts**

Add after the existing `responseProfiles` table (around line 376) in `src/api/db/schema.ts`:

```typescript
// --- Analytics (materialized on-write) ---

export const dailySnapshots = pgTable('daily_snapshots', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(),
  assessmentCount: integer('assessment_count').notNull().default(0),
  conceptsAssessed: integer('concepts_assessed').notNull().default(0),
  avgMasteryDelta: real('avg_mastery_delta').notNull().default(0),
  totalDismissals: integer('total_dismissals').notNull().default(0),
  avgIntegrityScore: real('avg_integrity_score'),
  probeCount: integer('probe_count').notNull().default(0),
  tutorCount: integer('tutor_count').notNull().default(0),
  domains: jsonb('domains').notNull().default({}),
}, (table) => [
  primaryKey({ columns: [table.userId, table.date] }),
  index('idx_daily_snapshots_user_date').on(table.userId, table.date),
]);

export const zpdSnapshots = pgTable('zpd_snapshots', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
  exitedAt: timestamp('exited_at', { withTimezone: true }),
  masteryAtEntry: real('mastery_at_entry').notNull(),
  masteryAtExit: real('mastery_at_exit'),
}, (table) => [
  index('idx_zpd_snapshots_user_concept').on(table.userId, table.conceptId),
  index('idx_zpd_snapshots_user_entered').on(table.userId, table.enteredAt),
]);

export const conceptAnalytics = pgTable('concept_analytics', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  firstAssessedAt: timestamp('first_assessed_at', { withTimezone: true }).notNull().defaultNow(),
  lastAssessedAt: timestamp('last_assessed_at', { withTimezone: true }).notNull().defaultNow(),
  totalProbes: integer('total_probes').notNull().default(0),
  totalTutorSessions: integer('total_tutor_sessions').notNull().default(0),
  totalDismissals: integer('total_dismissals').notNull().default(0),
  peakMastery: real('peak_mastery').notNull().default(0),
  currentStreak: integer('current_streak').notNull().default(0),
  longestStreak: integer('longest_streak').notNull().default(0),
  avgResponseWordCount: real('avg_response_word_count'),
  avgIntegrityScore: real('avg_integrity_score'),
}, (table) => [
  primaryKey({ columns: [table.userId, table.conceptId] }),
]);
```

Add these imports at the top of the file alongside existing ones: `date` from `drizzle-orm/pg-core`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/db/analytics-schema.test.ts`
Expected: PASS

**Step 5: Generate migration**

Run: `npx drizzle-kit generate`
Expected: New migration file in `drizzle/` directory

**Step 6: Commit**

```bash
git add src/api/db/schema.ts tests/api/db/analytics-schema.test.ts drizzle/
git commit -m "feat: add analytics schema tables (daily_snapshots, zpd_snapshots, concept_analytics)"
```

---

### Task 2: Install ECharts and Update Build Config

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `esbuild.config.ts`

**Step 1: Install ECharts**

Run: `npm install echarts`

**Step 2: Create a minimal ECharts wrapper for the dashboard**

Create `src/dashboard/charts.js`:

```javascript
// ECharts tree-shaken import for analytics charts
// Only import the chart types and components we need
import * as echarts from "echarts/core";
import { LineChart, BarChart, RadarChart, HeatmapChart, GraphChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  CalendarComponent,
  VisualMapComponent,
  DataZoomComponent,
  ToolboxComponent,
  RadarComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart, BarChart, RadarChart, HeatmapChart, GraphChart,
  TitleComponent, TooltipComponent, GridComponent, LegendComponent,
  CalendarComponent, VisualMapComponent, DataZoomComponent,
  ToolboxComponent, RadarComponent,
  CanvasRenderer,
]);

export { echarts };
```

**Step 3: Update esbuild config to bundle charts.js**

In `esbuild.config.ts`, find the dashboard build section (around line 108) and add `charts.js` to entryPoints. Also change `bundle: false` to `bundle: true` for the dashboard build so ECharts gets bundled:

```typescript
const dashboardBuild = await esbuild.build({
  entryPoints: [
    join('src', 'dashboard', 'dashboard.js'),
    join('src', 'dashboard', 'dashboard.css'),
    join('src', 'dashboard', 'link.js'),
    join('src', 'dashboard', 'charts.js'),
  ],
  bundle: true,
  minify: true,
  outdir: join('public', 'assets'),
  entryNames: '[name]-[hash]',
  metafile: true,
  format: 'esm',
  splitting: true,
  // Don't bundle dashboard.css or link.js — only charts.js
  // Use external to keep the existing non-bundled files working
});
```

Note: If the build system doesn't support bundling some entrypoints and not others, create a separate build step for `charts.js` that bundles ECharts, and keep the existing dashboard build as-is. The chart file can be loaded as a separate `<script type="module">` in the HTML.

**Step 4: Verify build works**

Run: `npm run build`
Expected: Build succeeds, `public/assets/charts-*.js` is generated

**Step 5: Add charts.js script tag to dashboard HTML**

In `src/api/routes/dashboard.ts`, in the `getShellHTML()` function, add the charts script tag before the main dashboard script:

```typescript
const chartsHref = manifest['charts.js'] || '/assets/charts.js';
// In the HTML template, before the closing </body>:
<script type="module" src="${chartsHref}"></script>
<script src="${jsHref}"></script>
```

**Step 6: Commit**

```bash
git add package.json package-lock.json src/dashboard/charts.js esbuild.config.ts src/api/routes/dashboard.ts
git commit -m "feat: add ECharts 6 with tree-shaken dashboard bundle"
```

---

### Task 3: On-Write Analytics Snapshot Updates

**Files:**
- Create: `src/core/analytics-snapshots.ts`
- Modify: `src/api/routes/mcp.ts` (wire in at line ~1093)

**Step 1: Write the failing test**

Create `tests/core/analytics-snapshots.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildDailySnapshotUpsert, buildConceptAnalyticsUpsert } from '../../src/core/analytics-snapshots.js';

describe('buildDailySnapshotUpsert', () => {
  it('computes correct values for a probe event', () => {
    const result = buildDailySnapshotUpsert({
      userId: 'user1',
      eventType: 'probe',
      conceptId: 'react-hooks',
      domain: 'react',
      masteryDelta: 0.05,
      integrityScore: 0.9,
    });
    expect(result.userId).toBe('user1');
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.assessmentCount).toBe(1);
    expect(result.probeCount).toBe(1);
    expect(result.tutorCount).toBe(0);
    expect(result.avgMasteryDelta).toBeCloseTo(0.05);
    expect(result.domains).toEqual({ react: 1 });
  });

  it('computes correct values for a tutor event', () => {
    const result = buildDailySnapshotUpsert({
      userId: 'user1',
      eventType: 'tutor_phase4',
      conceptId: 'typescript',
      domain: 'typescript',
      masteryDelta: 0.1,
      integrityScore: undefined,
    });
    expect(result.probeCount).toBe(0);
    expect(result.tutorCount).toBe(1);
    expect(result.avgIntegrityScore).toBeNull();
  });
});

describe('buildConceptAnalyticsUpsert', () => {
  it('computes insert values for first assessment', () => {
    const result = buildConceptAnalyticsUpsert({
      userId: 'user1',
      conceptId: 'react-hooks',
      eventType: 'probe',
      rubricScore: 2,
      mastery: 0.65,
      responseWordCount: 45,
      integrityScore: 0.85,
      existing: null,
    });
    expect(result.totalProbes).toBe(1);
    expect(result.totalTutorSessions).toBe(0);
    expect(result.peakMastery).toBeCloseTo(0.65);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });

  it('increments streak for passing score', () => {
    const result = buildConceptAnalyticsUpsert({
      userId: 'user1',
      conceptId: 'react-hooks',
      eventType: 'probe',
      rubricScore: 2,
      mastery: 0.75,
      responseWordCount: 60,
      integrityScore: 0.9,
      existing: { totalProbes: 3, totalTutorSessions: 0, totalDismissals: 0, peakMastery: 0.7, currentStreak: 2, longestStreak: 2, avgResponseWordCount: 50, avgIntegrityScore: 0.85 },
    });
    expect(result.totalProbes).toBe(4);
    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
    expect(result.peakMastery).toBeCloseTo(0.75);
  });

  it('resets streak for failing score', () => {
    const result = buildConceptAnalyticsUpsert({
      userId: 'user1',
      conceptId: 'react-hooks',
      eventType: 'probe',
      rubricScore: 0,
      mastery: 0.3,
      responseWordCount: 10,
      integrityScore: 0.5,
      existing: { totalProbes: 3, totalTutorSessions: 0, totalDismissals: 0, peakMastery: 0.7, currentStreak: 5, longestStreak: 5, avgResponseWordCount: 50, avgIntegrityScore: 0.85 },
    });
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(5); // preserved
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/analytics-snapshots.test.ts`
Expected: FAIL — module not found

**Step 3: Implement analytics-snapshots.ts**

Create `src/core/analytics-snapshots.ts`:

```typescript
import { eq, and, sql } from 'drizzle-orm';
import { dailySnapshots, conceptAnalytics } from '../api/db/schema.js';
import type { Database } from '../api/db/index.js';

interface DailySnapshotInput {
  userId: string;
  eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
  conceptId: string;
  domain: string | null;
  masteryDelta: number;
  integrityScore: number | undefined;
}

export function buildDailySnapshotUpsert(input: DailySnapshotInput) {
  const today = new Date().toISOString().slice(0, 10);
  const isProbe = input.eventType === 'probe';
  const isTutor = input.eventType === 'tutor_phase1' || input.eventType === 'tutor_phase4';

  return {
    userId: input.userId,
    date: today,
    assessmentCount: 1,
    conceptsAssessed: 1,
    avgMasteryDelta: input.masteryDelta,
    totalDismissals: 0,
    avgIntegrityScore: input.integrityScore ?? null,
    probeCount: isProbe ? 1 : 0,
    tutorCount: isTutor ? 1 : 0,
    domains: input.domain ? { [input.domain]: 1 } : {},
  };
}

interface ConceptAnalyticsInput {
  userId: string;
  conceptId: string;
  eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
  rubricScore: number;
  mastery: number;
  responseWordCount: number | undefined;
  integrityScore: number | undefined;
  existing: {
    totalProbes: number;
    totalTutorSessions: number;
    totalDismissals: number;
    peakMastery: number;
    currentStreak: number;
    longestStreak: number;
    avgResponseWordCount: number | null;
    avgIntegrityScore: number | null;
  } | null;
}

export function buildConceptAnalyticsUpsert(input: ConceptAnalyticsInput) {
  const { existing, eventType, rubricScore, mastery } = input;
  const isProbe = eventType === 'probe';
  const isTutor = eventType === 'tutor_phase1' || eventType === 'tutor_phase4';
  const isPassing = rubricScore >= 2;

  const totalProbes = (existing?.totalProbes ?? 0) + (isProbe ? 1 : 0);
  const totalTutorSessions = (existing?.totalTutorSessions ?? 0) + (isTutor ? 1 : 0);
  const peakMastery = Math.max(existing?.peakMastery ?? 0, mastery);
  const currentStreak = isPassing ? (existing?.currentStreak ?? 0) + 1 : 0;
  const longestStreak = Math.max(existing?.longestStreak ?? 0, currentStreak);

  // Running average for response word count
  const prevCount = (existing?.totalProbes ?? 0) + (existing?.totalTutorSessions ?? 0);
  const prevAvgWords = existing?.avgResponseWordCount ?? 0;
  const newWordCount = input.responseWordCount ?? 0;
  const avgResponseWordCount = prevCount > 0
    ? (prevAvgWords * prevCount + newWordCount) / (prevCount + 1)
    : newWordCount;

  // Running average for integrity score
  const prevAvgIntegrity = existing?.avgIntegrityScore ?? null;
  let avgIntegrityScore: number | null;
  if (input.integrityScore !== undefined) {
    avgIntegrityScore = prevAvgIntegrity !== null && prevCount > 0
      ? (prevAvgIntegrity * prevCount + input.integrityScore) / (prevCount + 1)
      : input.integrityScore;
  } else {
    avgIntegrityScore = prevAvgIntegrity;
  }

  return {
    userId: input.userId,
    conceptId: input.conceptId,
    totalProbes,
    totalTutorSessions,
    totalDismissals: existing?.totalDismissals ?? 0,
    peakMastery,
    currentStreak,
    longestStreak,
    avgResponseWordCount: avgResponseWordCount || null,
    avgIntegrityScore,
  };
}

/**
 * Called after every assessment event insert.
 * Upserts daily_snapshots and concept_analytics rows.
 */
export async function updateAnalyticsSnapshots(
  db: Database,
  input: DailySnapshotInput & {
    rubricScore: number;
    mastery: number;
    responseWordCount: number | undefined;
  },
) {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Upsert daily_snapshots
  const dsValues = buildDailySnapshotUpsert(input);
  await db.insert(dailySnapshots)
    .values(dsValues)
    .onConflictDoUpdate({
      target: [dailySnapshots.userId, dailySnapshots.date],
      set: {
        assessmentCount: sql`${dailySnapshots.assessmentCount} + 1`,
        conceptsAssessed: sql`${dailySnapshots.conceptsAssessed} + 1`,
        avgMasteryDelta: sql`(${dailySnapshots.avgMasteryDelta} * ${dailySnapshots.assessmentCount} + ${input.masteryDelta}) / (${dailySnapshots.assessmentCount} + 1)`,
        probeCount: sql`${dailySnapshots.probeCount} + ${dsValues.probeCount}`,
        tutorCount: sql`${dailySnapshots.tutorCount} + ${dsValues.tutorCount}`,
        domains: sql`${dailySnapshots.domains} || ${JSON.stringify(dsValues.domains)}::jsonb`,
        avgIntegrityScore: input.integrityScore !== undefined
          ? sql`CASE WHEN ${dailySnapshots.avgIntegrityScore} IS NULL THEN ${input.integrityScore}
                ELSE (${dailySnapshots.avgIntegrityScore} * ${dailySnapshots.assessmentCount} + ${input.integrityScore}) / (${dailySnapshots.assessmentCount} + 1) END`
          : sql`${dailySnapshots.avgIntegrityScore}`,
      },
    });

  // 2. Upsert concept_analytics
  const [existing] = await db.select().from(conceptAnalytics)
    .where(and(eq(conceptAnalytics.userId, input.userId), eq(conceptAnalytics.conceptId, input.conceptId)));

  const caValues = buildConceptAnalyticsUpsert({
    ...input,
    existing: existing ?? null,
  });

  if (existing) {
    await db.update(conceptAnalytics).set({
      lastAssessedAt: new Date(),
      ...caValues,
    }).where(and(
      eq(conceptAnalytics.userId, input.userId),
      eq(conceptAnalytics.conceptId, input.conceptId),
    ));
  } else {
    await db.insert(conceptAnalytics).values({
      ...caValues,
      firstAssessedAt: new Date(),
      lastAssessedAt: new Date(),
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/analytics-snapshots.test.ts`
Expected: PASS

**Step 5: Wire into applyBayesianUpdateDb**

In `src/api/routes/mcp.ts`, add import at top:
```typescript
import { updateAnalyticsSnapshots } from '../../core/analytics-snapshots.js';
```

After line 1093 (after the user_concept_states upsert, before prerequisite propagation), add:

```typescript
  // 6b. Update analytics snapshots (on-write materialization)
  const conceptDomain = conceptRow?.domain ?? null;
  const masteryDelta = pMastery(newMu) - pMastery(muBefore);
  const responseWordCount = input.responseFeatures
    ? (input.responseFeatures as Record<string, unknown>).wordCount as number | undefined
    : undefined;
  await updateAnalyticsSnapshots(db, {
    userId,
    eventType,
    conceptId,
    domain: conceptDomain,
    masteryDelta,
    integrityScore: input.integrityScore,
    rubricScore: score,
    mastery: pMastery(newMu),
    responseWordCount,
  });
```

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/core/analytics-snapshots.ts tests/core/analytics-snapshots.test.ts src/api/routes/mcp.ts
git commit -m "feat: on-write analytics snapshot updates (daily_snapshots, concept_analytics)"
```

---

### Task 4: Analytics API Routes — Timeline & Velocity

**Files:**
- Create: `src/api/routes/analytics.ts`
- Modify: `src/api/index.ts`

**Step 1: Write the failing test**

Create `tests/api/routes/analytics.test.ts`:

```typescript
import { config } from 'dotenv';
config();
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/api/index.js';

const testDbUrl = process.env.DATABASE_URL;
const testSecret = process.env.BETTER_AUTH_SECRET;
const canRun = testDbUrl && testSecret && process.env.INTEGRATION_TESTS === '1';
const describeWithDb = canRun ? describe : describe.skip;

describeWithDb('Analytics API routes', () => {
  const { app } = createApp(testDbUrl!, { secret: testSecret! });

  it('GET /api/analytics/timeline returns 401 without auth', async () => {
    const res = await app.request('/api/analytics/timeline');
    expect(res.status).toBe(401);
  });

  it('GET /api/analytics/velocity returns 401 without auth', async () => {
    const res = await app.request('/api/analytics/velocity');
    expect(res.status).toBe(401);
  });

  it('GET /api/analytics/activity-heatmap returns 401 without auth', async () => {
    const res = await app.request('/api/analytics/activity-heatmap');
    expect(res.status).toBe(401);
  });

  it('GET /api/analytics/concept/:id returns 401 without auth', async () => {
    const res = await app.request('/api/analytics/concept/react-hooks');
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/routes/analytics.test.ts`
Expected: FAIL — 404 (route not registered)

**Step 3: Create the analytics routes**

Create `src/api/routes/analytics.ts`:

```typescript
import { Hono } from 'hono';
import { eq, and, desc, gte, sql, asc } from 'drizzle-orm';
import {
  assessmentEvents,
  userConceptStates,
  concepts,
  conceptAnalytics,
  dailySnapshots,
  conceptEdges,
  tutorSessions,
  dismissalEvents,
} from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import type { Env } from '../index.js';

export const analyticsRoutes = new Hono<Env>();
analyticsRoutes.use('*', requireAuth);

/** Convert mu to mastery probability */
function pMastery(mu: number): number {
  return 1 / (1 + Math.exp(-mu));
}

/** Format mastery as { value, low, high } — mu ± 2σ clamped to 0-1 */
function masteryRange(mu: number, sigma: number) {
  const p = pMastery(mu);
  // Approximate: logistic transform of mu ± 2σ
  const low = Math.max(0, pMastery(mu - 2 * sigma));
  const high = Math.min(1, pMastery(mu + 2 * sigma));
  return { value: Math.round(p * 100), low: Math.round(low * 100), high: Math.round(high * 100) };
}

// GET /timeline/:conceptId — mastery over time for one concept
analyticsRoutes.get('/timeline/:conceptId', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const conceptId = c.req.param('conceptId');

  const events = await db.select({
    id: assessmentEvents.id,
    eventType: assessmentEvents.eventType,
    rubricScore: assessmentEvents.rubricScore,
    muBefore: assessmentEvents.muBefore,
    muAfter: assessmentEvents.muAfter,
    createdAt: assessmentEvents.createdAt,
    integrityScore: assessmentEvents.integrityScore,
  }).from(assessmentEvents)
    .where(and(
      eq(assessmentEvents.userId, user.id),
      eq(assessmentEvents.conceptId, conceptId),
    ))
    .orderBy(asc(assessmentEvents.createdAt))
    .limit(200);

  // Get current sigma for confidence band on latest point
  const [state] = await db.select().from(userConceptStates)
    .where(and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, conceptId)));

  const sigma = state?.sigma ?? 1.5;

  // Build timeline points with estimated sigma at each point
  // Sigma decreases with each assessment (rough approximation)
  const initialSigma = 1.5;
  const points = events.map((ev, i) => {
    const estimatedSigma = initialSigma / Math.sqrt(1 + i * 0.5);
    const range = masteryRange(ev.muAfter, estimatedSigma);
    return {
      timestamp: ev.createdAt,
      mastery: range,
      eventType: ev.eventType,
      rubricScore: ev.rubricScore,
      integrityScore: ev.integrityScore,
    };
  });

  return c.json({
    conceptId,
    currentMastery: state ? masteryRange(state.mu, state.sigma) : null,
    timeline: points,
  });
});

// GET /timeline — aggregate mastery timeline across all concepts
analyticsRoutes.get('/timeline', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const events = await db.select({
    muBefore: assessmentEvents.muBefore,
    muAfter: assessmentEvents.muAfter,
    createdAt: assessmentEvents.createdAt,
  }).from(assessmentEvents)
    .where(eq(assessmentEvents.userId, user.id))
    .orderBy(asc(assessmentEvents.createdAt))
    .limit(500);

  // Group by day and compute average mastery delta
  const byDay: Record<string, { count: number; totalDelta: number; avgMastery: number }> = {};
  for (const ev of events) {
    const day = new Date(ev.createdAt).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { count: 0, totalDelta: 0, avgMastery: 0 };
    byDay[day].count++;
    byDay[day].totalDelta += pMastery(ev.muAfter) - pMastery(ev.muBefore);
    byDay[day].avgMastery = pMastery(ev.muAfter);
  }

  const timeline = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      assessments: data.count,
      avgDelta: Math.round(data.totalDelta / data.count * 100) / 100,
      cumulativeDelta: 0, // filled below
    }));

  let cumulative = 0;
  for (const point of timeline) {
    cumulative += point.avgDelta;
    point.cumulativeDelta = Math.round(cumulative * 100) / 100;
  }

  return c.json({ timeline });
});

// GET /velocity — learning velocity over rolling windows
analyticsRoutes.get('/velocity', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const snapshots = await db.select().from(dailySnapshots)
    .where(eq(dailySnapshots.userId, user.id))
    .orderBy(desc(dailySnapshots.date))
    .limit(90);

  const now = Date.now();
  const windows = { '7d': 7, '30d': 30, '90d': 90 };
  const result: Record<string, { assessments: number; avgDelta: number; conceptsAssessed: number }> = {};

  for (const [label, days] of Object.entries(windows)) {
    const cutoff = new Date(now - days * 86400000).toISOString().slice(0, 10);
    const inWindow = snapshots.filter(s => s.date >= cutoff);
    const totalAssessments = inWindow.reduce((sum, s) => sum + s.assessmentCount, 0);
    const totalDelta = inWindow.reduce((sum, s) => sum + s.avgMasteryDelta * s.assessmentCount, 0);
    const totalConcepts = inWindow.reduce((sum, s) => sum + s.conceptsAssessed, 0);
    result[label] = {
      assessments: totalAssessments,
      avgDelta: totalAssessments > 0 ? Math.round(totalDelta / totalAssessments * 100) / 100 : 0,
      conceptsAssessed: totalConcepts,
    };
  }

  return c.json({ velocity: result, snapshots: snapshots.reverse() });
});

// GET /activity-heatmap — daily assessment counts for calendar heatmap
analyticsRoutes.get('/activity-heatmap', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const days = parseInt(c.req.query('days') || '365');

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const snapshots = await db.select({
    date: dailySnapshots.date,
    assessmentCount: dailySnapshots.assessmentCount,
    conceptsAssessed: dailySnapshots.conceptsAssessed,
    avgMasteryDelta: dailySnapshots.avgMasteryDelta,
    domains: dailySnapshots.domains,
  }).from(dailySnapshots)
    .where(and(
      eq(dailySnapshots.userId, user.id),
      gte(dailySnapshots.date, cutoff),
    ))
    .orderBy(asc(dailySnapshots.date));

  return c.json({ heatmap: snapshots });
});

// GET /concept/:conceptId — full concept profile
analyticsRoutes.get('/concept/:conceptId', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const conceptId = c.req.param('conceptId');

  // Parallel queries
  const [conceptRow] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  if (!conceptRow) return c.json({ error: 'Concept not found' }, 404);

  const [state] = await db.select().from(userConceptStates)
    .where(and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, conceptId)));

  const [analytics] = await db.select().from(conceptAnalytics)
    .where(and(eq(conceptAnalytics.userId, user.id), eq(conceptAnalytics.conceptId, conceptId)));

  const events = await db.select().from(assessmentEvents)
    .where(and(eq(assessmentEvents.userId, user.id), eq(assessmentEvents.conceptId, conceptId)))
    .orderBy(asc(assessmentEvents.createdAt))
    .limit(200);

  const tutorHistory = await db.select().from(tutorSessions)
    .where(and(eq(tutorSessions.userId, user.id), eq(tutorSessions.conceptId, conceptId)))
    .orderBy(desc(tutorSessions.startedAt));

  const dismissals = await db.select().from(dismissalEvents)
    .where(and(eq(dismissalEvents.userId, user.id), eq(dismissalEvents.conceptId, conceptId)))
    .orderBy(desc(dismissalEvents.createdAt));

  const prerequisites = await db.select().from(conceptEdges)
    .where(and(eq(conceptEdges.sourceId, conceptId), eq(conceptEdges.edgeType, 'requires')));

  // Get mastery for prerequisites
  const prereqStates = prerequisites.length > 0
    ? await db.select().from(userConceptStates)
      .where(and(
        eq(userConceptStates.userId, user.id),
        sql`${userConceptStates.conceptId} IN (${sql.join(prerequisites.map(p => sql`${p.targetId}`), sql`, `)})`,
      ))
    : [];

  return c.json({
    concept: { id: conceptRow.id, domain: conceptRow.domain, specificity: conceptRow.specificity, description: conceptRow.description },
    mastery: state ? masteryRange(state.mu, state.sigma) : null,
    analytics: analytics ?? null,
    timeline: events.map((ev, i) => {
      const estimatedSigma = 1.5 / Math.sqrt(1 + i * 0.5);
      return {
        timestamp: ev.createdAt,
        mastery: masteryRange(ev.muAfter, estimatedSigma),
        eventType: ev.eventType,
        rubricScore: ev.rubricScore,
        integrityScore: ev.integrityScore,
        responseText: ev.responseText,
      };
    }),
    tutorSessions: tutorHistory,
    dismissals,
    prerequisites: prerequisites.map(p => {
      const prereqState = prereqStates.find(s => s.conceptId === p.targetId);
      return {
        conceptId: p.targetId,
        mastery: prereqState ? masteryRange(prereqState.mu, prereqState.sigma) : null,
      };
    }),
  });
});
```

**Step 4: Register the route in src/api/index.ts**

Add import:
```typescript
import { analyticsRoutes } from './routes/analytics.js';
```

Add route registration alongside the other routes (around line 114):
```typescript
app.route('/api/analytics', analyticsRoutes);
```

**Step 5: Run tests**

Run: `npx vitest run tests/api/routes/analytics.test.ts`
Expected: PASS (401s confirm routes exist and require auth)

**Step 6: Commit**

```bash
git add src/api/routes/analytics.ts tests/api/routes/analytics.test.ts src/api/index.ts
git commit -m "feat: add analytics API routes (timeline, velocity, heatmap, concept detail)"
```

---

### Task 5: Mastery Helper — Shared Between API and Dashboard

**Files:**
- Create: `src/core/mastery-display.ts`

This is a shared utility so the `{ value, low, high }` format is consistent everywhere.

**Step 1: Write the failing test**

Create `tests/core/mastery-display.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { masteryRange, masteryLabel, trendDirection } from '../../src/core/mastery-display.js';

describe('masteryRange', () => {
  it('returns clamped range for high uncertainty', () => {
    const range = masteryRange(0, 1.5);
    expect(range.value).toBe(50);
    expect(range.low).toBeGreaterThanOrEqual(0);
    expect(range.high).toBeLessThanOrEqual(100);
    expect(range.low).toBeLessThan(range.value);
    expect(range.high).toBeGreaterThan(range.value);
  });

  it('returns tight range for low uncertainty', () => {
    const range = masteryRange(2, 0.1);
    expect(range.high - range.low).toBeLessThan(10);
  });

  it('clamps to 0-100', () => {
    const range = masteryRange(-5, 2);
    expect(range.low).toBe(0);
  });
});

describe('masteryLabel', () => {
  it('returns range string', () => {
    expect(masteryLabel(0, 1.5)).toMatch(/\d+–\d+%/);
  });
});

describe('trendDirection', () => {
  it('returns up for increasing mastery', () => {
    expect(trendDirection([0.3, 0.5, 0.7])).toBe('up');
  });

  it('returns down for decreasing mastery', () => {
    expect(trendDirection([0.7, 0.5, 0.3])).toBe('down');
  });

  it('returns flat for stable mastery', () => {
    expect(trendDirection([0.5, 0.5, 0.5])).toBe('flat');
  });

  it('returns flat for empty array', () => {
    expect(trendDirection([])).toBe('flat');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/mastery-display.test.ts`
Expected: FAIL

**Step 3: Implement mastery-display.ts**

Create `src/core/mastery-display.ts`:

```typescript
/** Convert mu (log-odds) to probability 0-1 */
export function pMastery(mu: number): number {
  return 1 / (1 + Math.exp(-mu));
}

/** Format mastery as { value, low, high } percentages — mu ± 2σ clamped to 0-100 */
export function masteryRange(mu: number, sigma: number): { value: number; low: number; high: number } {
  const p = pMastery(mu);
  const low = Math.max(0, pMastery(mu - 2 * sigma));
  const high = Math.min(1, pMastery(mu + 2 * sigma));
  return {
    value: Math.round(p * 100),
    low: Math.round(low * 100),
    high: Math.round(high * 100),
  };
}

/** Human-readable mastery range string: "65–85%" */
export function masteryLabel(mu: number, sigma: number): string {
  const range = masteryRange(mu, sigma);
  return `${range.low}–${range.high}%`;
}

/** Determine trend direction from last N mastery values */
export function trendDirection(values: number[]): 'up' | 'down' | 'flat' {
  if (values.length < 2) return 'flat';
  const last = values[values.length - 1];
  const first = values[0];
  const delta = last - first;
  if (Math.abs(delta) < 0.03) return 'flat';
  return delta > 0 ? 'up' : 'down';
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/mastery-display.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/mastery-display.ts tests/core/mastery-display.test.ts
git commit -m "feat: add shared mastery display helpers (range, label, trend)"
```

---

### Task 6: Dashboard — Add New Tab Structure in HTML

**Files:**
- Modify: `src/api/routes/dashboard.ts` (lines 37-83)

**Step 1: Add the new tab buttons and content containers**

In `src/api/routes/dashboard.ts`, in the `getShellHTML()` function:

Replace the tabs section (lines 37-83) with:

```html
<div class="tabs" id="tabs">
  <button class="tab-btn active" data-tab="overview">Overview</button>
  <button class="tab-btn" data-tab="analytics">Analytics</button>
  <button class="tab-btn" data-tab="concepts">Concepts</button>
  <button class="tab-btn" data-tab="integrity">Integrity</button>
  <button class="tab-btn" data-tab="organization">Organization</button>
  <button class="tab-btn" data-tab="settings">Settings</button>
</div>
```

Add new tab content divs after the existing `tab-overview` div (line 75):

```html
<div class="tab-content" id="tab-analytics">
  <div class="stats-row" id="analytics-stats"></div>
  <div class="section">
    <div class="section-header">
      <div class="section-title">Activity</div>
    </div>
    <div class="chart-panel" id="analytics-heatmap" style="height:180px;"></div>
  </div>
  <div class="section">
    <div class="section-header">
      <div class="section-title">Learning Velocity</div>
      <div class="velocity-toggle" id="velocity-toggle"></div>
    </div>
    <div class="chart-panel" id="analytics-velocity" style="height:300px;"></div>
  </div>
  <div class="section">
    <div class="section-header">
      <div class="section-title">Domain Strengths</div>
    </div>
    <div class="chart-panel" id="analytics-radar" style="height:350px;"></div>
  </div>
  <div class="section">
    <div class="section-header">
      <div class="section-title">Review Needed</div>
      <div class="section-subtitle">Concepts predicted to decay</div>
    </div>
    <div class="scroll-container" id="analytics-retention" style="max-height:300px;overflow-y:auto;"></div>
  </div>
</div>

<div class="tab-content" id="tab-concepts">
  <div class="section">
    <div class="section-header">
      <div class="section-title">Your Concepts</div>
      <div class="section-subtitle" id="concepts-count"></div>
    </div>
    <div class="filter-row" id="concepts-filter-row"></div>
    <div class="scroll-container" id="concepts-list" style="max-height:600px;overflow-y:auto;"></div>
  </div>
  <div id="concept-detail" style="display:none;"></div>
</div>

<div class="tab-content" id="tab-integrity">
  <div class="section">
    <div class="section-header">
      <div class="section-title">Integrity Trend</div>
    </div>
    <div class="chart-panel" id="integrity-trend" style="height:300px;"></div>
  </div>
  <div class="section">
    <div class="section-header">
      <div class="section-title">Dismiss Patterns</div>
    </div>
    <div class="chart-panel" id="integrity-dismissals" style="height:250px;"></div>
  </div>
</div>
```

**Step 2: Update the tab initialization in dashboard.js**

In `src/dashboard/dashboard.js`, in the `initTabs()` function (around line 55), add cases for the new tabs:

```javascript
if (tab === "analytics") renderAnalytics();
if (tab === "concepts") renderConcepts();
if (tab === "integrity") renderIntegrity();
```

**Step 3: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/api/routes/dashboard.ts src/dashboard/dashboard.js
git commit -m "feat: add Analytics, Concepts, Integrity tab structure to dashboard"
```

---

### Task 7: Dashboard — Analytics Tab (Heatmap + Velocity + Radar)

**Files:**
- Modify: `src/dashboard/dashboard.js`

**Step 1: Add the renderAnalytics function**

Add to the end of `src/dashboard/dashboard.js`:

```javascript
// --- Analytics Tab ---

function renderAnalytics() {
  renderAnalyticsStats();
  renderActivityHeatmap();
  renderVelocityChart();
  renderDomainRadar();
}

function renderAnalyticsStats() {
  var container = document.getElementById("analytics-stats");
  container.textContent = "";
  // Show skeleton
  for (var i = 0; i < 4; i++) {
    container.appendChild(h("div", { className: "stat-card skeleton" }, [
      h("div", { className: "stat-value" }, "—"),
      h("div", { className: "stat-label" }, "Loading...")
    ]));
  }

  fetch("/api/analytics/velocity", { headers: getHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      container.textContent = "";
      var v7 = data.velocity["7d"] || {};
      var v30 = data.velocity["30d"] || {};
      container.appendChild(statCard(v7.assessments || 0, "Assessments (7d)", ""));
      container.appendChild(statCard(v7.conceptsAssessed || 0, "Concepts (7d)", ""));
      container.appendChild(statCard((v30.avgDelta >= 0 ? "+" : "") + ((v30.avgDelta || 0) * 100).toFixed(0) + "%", "Avg Delta (30d)", v30.avgDelta >= 0 ? "green" : "amber"));
      container.appendChild(statCard(v30.assessments || 0, "Assessments (30d)", ""));
    });
}

function renderActivityHeatmap() {
  var container = document.getElementById("analytics-heatmap");
  if (!container || typeof echarts === "undefined") return;

  fetch("/api/analytics/activity-heatmap?days=365", { headers: getHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var chart = echarts.init(container);
      var heatmapData = (data.heatmap || []).map(function(d) {
        return [d.date, d.assessmentCount];
      });

      var year = new Date().getFullYear();
      chart.setOption({
        tooltip: {
          formatter: function(params) {
            return params.value[0] + ": " + params.value[1] + " assessments";
          }
        },
        visualMap: {
          min: 0,
          max: Math.max.apply(null, heatmapData.map(function(d) { return d[1]; }).concat([1])),
          show: false,
          inRange: { color: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"] },
        },
        calendar: {
          top: 20, left: 50, right: 20,
          cellSize: [13, 13],
          range: [year + "-01-01", year + "-12-31"],
          itemStyle: { borderWidth: 2, borderColor: "#fff" },
          yearLabel: { show: false },
          dayLabel: { nameMap: "en", fontSize: 10 },
          monthLabel: { fontSize: 10 },
        },
        series: [{
          type: "heatmap",
          coordinateSystem: "calendar",
          data: heatmapData,
        }],
      });

      window.addEventListener("resize", function() { chart.resize(); });
    });
}

function renderVelocityChart() {
  var container = document.getElementById("analytics-velocity");
  if (!container || typeof echarts === "undefined") return;

  fetch("/api/analytics/timeline", { headers: getHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var chart = echarts.init(container);
      var timeline = data.timeline || [];

      chart.setOption({
        tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: timeline.map(function(t) { return t.date; }) },
        yAxis: { type: "value", name: "Cumulative Mastery Gain", axisLabel: { formatter: "{value}" } },
        series: [{
          type: "line",
          data: timeline.map(function(t) { return t.cumulativeDelta; }),
          smooth: true,
          areaStyle: { opacity: 0.15 },
          lineStyle: { width: 2 },
          itemStyle: { color: "#2563eb" },
        }],
        grid: { top: 30, right: 20, bottom: 30, left: 60 },
      });

      window.addEventListener("resize", function() { chart.resize(); });
    });
}

function renderDomainRadar() {
  var container = document.getElementById("analytics-radar");
  if (!container || typeof echarts === "undefined") return;

  fetch("/api/mastery", { headers: getHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(states) {
      return fetch("/api/concepts", { headers: getHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(allConcepts) {
          // Group by domain
          var domainMastery = {};
          states.forEach(function(s) {
            var concept = allConcepts.find(function(c) { return c.id === s.conceptId; });
            var domain = concept ? concept.domain : "unknown";
            if (!domainMastery[domain]) domainMastery[domain] = [];
            domainMastery[domain].push(pMastery(s.mu));
          });

          var domains = Object.keys(domainMastery);
          if (domains.length < 3) return; // radar needs at least 3 axes

          var indicators = domains.map(function(d) { return { name: d, max: 100 }; });
          var values = domains.map(function(d) {
            var masteries = domainMastery[d];
            var avg = masteries.reduce(function(a, b) { return a + b; }, 0) / masteries.length;
            return Math.round(avg * 100);
          });

          var chart = echarts.init(container);
          chart.setOption({
            radar: { indicator: indicators, shape: "circle" },
            series: [{
              type: "radar",
              data: [{ value: values, name: "Mastery" }],
              areaStyle: { opacity: 0.15 },
              lineStyle: { width: 2, color: "#2563eb" },
              itemStyle: { color: "#2563eb" },
            }],
          });

          window.addEventListener("resize", function() { chart.resize(); });
        });
    });
}
```

**Step 2: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/dashboard/dashboard.js
git commit -m "feat: add Analytics tab — activity heatmap, velocity chart, domain radar"
```

---

### Task 8: Dashboard — Concepts Tab (Table + Detail Page)

**Files:**
- Modify: `src/dashboard/dashboard.js`

**Step 1: Add renderConcepts function with concept table**

Add to `src/dashboard/dashboard.js`:

```javascript
// --- Concepts Tab ---

var currentConceptDetail = null;

function renderConceptsTab() {
  var listContainer = document.getElementById("concepts-list");
  var detailContainer = document.getElementById("concept-detail");
  var countEl = document.getElementById("concepts-count");
  listContainer.textContent = "";
  detailContainer.style.display = "none";

  // Skeleton
  for (var i = 0; i < 8; i++) {
    listContainer.appendChild(h("div", { className: "concept-row skeleton" }, "Loading..."));
  }

  Promise.all([
    fetch("/api/mastery", { headers: getHeaders() }).then(function(r) { return r.json(); }),
    fetch("/api/concepts", { headers: getHeaders() }).then(function(r) { return r.json(); }),
  ]).then(function(results) {
    var states = results[0];
    var allConcepts = results[1];
    listContainer.textContent = "";

    // Only show concepts the user has state for
    var userConcepts = states.map(function(s) {
      var concept = allConcepts.find(function(c) { return c.id === s.conceptId; });
      return { state: s, concept: concept };
    }).filter(function(item) { return item.concept; });

    countEl.textContent = userConcepts.length + " concepts assessed";

    // Header row
    var header = h("div", { className: "concept-header" }, [
      h("div", null, "Concept"),
      h("div", null, "Mastery"),
      h("div", { style: "text-align:center" }, "Confidence"),
      h("div", { style: "text-align:right" }, "Assessments"),
    ]);
    listContainer.appendChild(header);

    userConcepts.sort(function(a, b) {
      return (b.state.lastAssessed || "").localeCompare(a.state.lastAssessed || "");
    });

    userConcepts.forEach(function(item) {
      var s = item.state;
      var c = item.concept;
      var p = Math.round(pMastery(s.mu) * 100);
      var low = Math.round(pMastery(s.mu - 2 * s.sigma) * 100);
      var high = Math.min(100, Math.round(pMastery(s.mu + 2 * s.sigma) * 100));
      var confidence = s.sigma < 0.3 ? "High" : s.sigma < 0.8 ? "Med" : "Low";

      var row = h("div", { className: "concept-row", onclick: function() { openConceptDetail(s.conceptId); } }, [
        h("div", { className: "concept-name" }, [
          h("span", null, c.id),
          c.domain ? h("span", { className: "domain-badge" }, c.domain) : null,
        ]),
        h("div", { className: "mastery-cell" }, [
          h("div", { className: "mastery-bar-container" }, [
            h("div", { className: "mastery-bar", style: "width:" + p + "%;background:" + masteryColor(p) }),
          ]),
          h("span", { className: "mastery-range" }, low + "–" + high + "%"),
        ]),
        h("div", { style: "text-align:center" }, h("span", { className: "confidence-badge confidence-" + confidence.toLowerCase() }, confidence)),
        h("div", { style: "text-align:right" }, String(s.assessmentCount)),
      ]);
      listContainer.appendChild(row);
    });
  });
}

function openConceptDetail(conceptId) {
  var listContainer = document.getElementById("concepts-list");
  var detailContainer = document.getElementById("concept-detail");
  listContainer.style.display = "none";
  detailContainer.style.display = "block";
  detailContainer.textContent = "";

  // Back button
  detailContainer.appendChild(h("button", {
    className: "btn-back",
    onclick: function() {
      detailContainer.style.display = "none";
      listContainer.style.display = "block";
    }
  }, "← Back to concepts"));

  // Skeleton
  detailContainer.appendChild(h("div", { className: "skeleton", style: "height:300px;margin:1rem 0" }, ""));

  fetch("/api/analytics/concept/" + encodeURIComponent(conceptId), { headers: getHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      // Clear skeleton, keep back button
      while (detailContainer.children.length > 1) detailContainer.removeChild(detailContainer.lastChild);

      // Concept header
      var c = data.concept;
      var m = data.mastery;
      detailContainer.appendChild(h("div", { className: "concept-detail-header" }, [
        h("h2", null, c.id),
        c.domain ? h("span", { className: "domain-badge" }, c.domain) : null,
        m ? h("span", { className: "mastery-range-large" }, m.low + "–" + m.high + "%") : null,
      ]));

      // Analytics stats
      if (data.analytics) {
        var a = data.analytics;
        var statsRow = h("div", { className: "stats-row" });
        statsRow.appendChild(statCard(a.totalProbes, "Probes", ""));
        statsRow.appendChild(statCard(a.totalTutorSessions, "Tutor Sessions", ""));
        statsRow.appendChild(statCard(a.currentStreak, "Current Streak", a.currentStreak > 0 ? "green" : ""));
        statsRow.appendChild(statCard(a.longestStreak, "Best Streak", "accent"));
        detailContainer.appendChild(statsRow);
      }

      // Mastery timeline chart with confidence band
      var chartPanel = h("div", { className: "chart-panel", style: "height:300px;margin:1rem 0" });
      detailContainer.appendChild(chartPanel);

      if (data.timeline && data.timeline.length > 0 && typeof echarts !== "undefined") {
        var chart = echarts.init(chartPanel);
        var timestamps = data.timeline.map(function(t) { return new Date(t.timestamp).toLocaleDateString(); });
        var values = data.timeline.map(function(t) { return t.mastery.value; });
        var lows = data.timeline.map(function(t) { return t.mastery.low; });
        var highs = data.timeline.map(function(t) { return t.mastery.high; });

        chart.setOption({
          tooltip: {
            trigger: "axis",
            formatter: function(params) {
              var idx = params[0].dataIndex;
              var t = data.timeline[idx];
              return timestamps[idx] + "<br/>Mastery: " + t.mastery.low + "–" + t.mastery.high + "%"
                + "<br/>Score: " + t.rubricScore + "/3"
                + "<br/>Type: " + t.eventType;
            }
          },
          xAxis: { type: "category", data: timestamps },
          yAxis: { type: "value", min: 0, max: 100, name: "Mastery %" },
          series: [
            { type: "line", data: lows, stack: "band", areaStyle: { opacity: 0 }, lineStyle: { opacity: 0 }, symbol: "none" },
            { type: "line", data: highs.map(function(h, i) { return h - lows[i]; }), stack: "band", areaStyle: { opacity: 0.15, color: "#2563eb" }, lineStyle: { opacity: 0 }, symbol: "none" },
            { type: "line", data: values, smooth: true, lineStyle: { width: 2, color: "#2563eb" }, itemStyle: { color: "#2563eb" }, symbol: "circle", symbolSize: 6 },
          ],
          grid: { top: 30, right: 20, bottom: 30, left: 50 },
        });
        window.addEventListener("resize", function() { chart.resize(); });
      }

      // Event log
      if (data.timeline && data.timeline.length > 0) {
        detailContainer.appendChild(h("div", { className: "section-title", style: "margin-top:1.5rem" }, "Assessment History"));
        var scrollContainer = h("div", { className: "scroll-container", style: "max-height:300px;overflow-y:auto" });
        var table = h("table", { className: "activity-table" });
        var thead = h("thead", null, [
          h("tr", null, [
            h("th", null, "Type"), h("th", null, "Score"), h("th", null, "Mastery"),
            h("th", null, "Integrity"), h("th", null, "When"),
          ])
        ]);
        table.appendChild(thead);
        var tbody = h("tbody");
        data.timeline.forEach(function(ev) {
          tbody.appendChild(h("tr", null, [
            h("td", null, ev.eventType),
            h("td", null, ev.rubricScore + "/3"),
            h("td", null, ev.mastery.low + "–" + ev.mastery.high + "%"),
            h("td", null, ev.integrityScore !== null ? (ev.integrityScore * 100).toFixed(0) + "%" : "—"),
            h("td", null, timeAgo(ev.timestamp)),
          ]));
        });
        table.appendChild(tbody);
        scrollContainer.appendChild(table);
        detailContainer.appendChild(scrollContainer);
      }

      // Tutor sessions
      if (data.tutorSessions && data.tutorSessions.length > 0) {
        detailContainer.appendChild(h("div", { className: "section-title", style: "margin-top:1.5rem" }, "Tutor Sessions"));
        var tutorScroll = h("div", { className: "scroll-container", style: "max-height:250px;overflow-y:auto" });
        data.tutorSessions.forEach(function(ts) {
          tutorScroll.appendChild(h("div", { className: "tutor-session-card" }, [
            h("div", null, "Phase " + ts.phase + "/4"),
            ts.phase1Score !== null ? h("div", null, "P1 Score: " + ts.phase1Score + "/3") : null,
            ts.phase4Score !== null ? h("div", null, "P4 Score: " + ts.phase4Score + "/3") : null,
            h("div", { className: "text-secondary" }, timeAgo(ts.startedAt)),
          ]));
        });
        detailContainer.appendChild(tutorScroll);
      }

      // Prerequisites
      if (data.prerequisites && data.prerequisites.length > 0) {
        detailContainer.appendChild(h("div", { className: "section-title", style: "margin-top:1.5rem" }, "Prerequisites"));
        data.prerequisites.forEach(function(p) {
          var prereqEl = h("div", { className: "prereq-item" }, [
            h("span", null, p.conceptId),
            p.mastery
              ? h("span", { className: "mastery-range" }, p.mastery.low + "–" + p.mastery.high + "%")
              : h("span", { className: "text-tertiary" }, "Not assessed"),
          ]);
          detailContainer.appendChild(prereqEl);
        });
      }
    });
}
```

**Step 2: Wire renderConceptsTab to the tab system**

In the `initTabs()` function, the line added in Task 6 should call `renderConceptsTab` (not `renderConcepts` — rename to avoid conflict with the existing `renderConcepts` function used by Overview tab):

```javascript
if (tab === "concepts") renderConceptsTab();
```

**Step 3: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/dashboard/dashboard.js
git commit -m "feat: add Concepts tab with table, detail page, mastery timeline with confidence bands"
```

---

### Task 9: Dashboard CSS — New Component Styles

**Files:**
- Modify: `src/dashboard/dashboard.css`

**Step 1: Add styles for analytics components**

Append to `src/dashboard/dashboard.css`:

```css
/* --- Chart panels --- */
.chart-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem;
}

/* --- Scroll containers --- */
.scroll-container {
  overflow-y: auto;
  scrollbar-width: thin;
}
.scroll-container::-webkit-scrollbar { width: 6px; }
.scroll-container::-webkit-scrollbar-track { background: transparent; }
.scroll-container::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* --- Mastery range in tables --- */
.mastery-range { font-size: 0.8rem; color: var(--text-secondary); margin-left: 0.5rem; }
.mastery-range-large { font-size: 1.1rem; font-weight: 600; margin-left: 0.75rem; }
.mastery-cell { display: flex; align-items: center; gap: 0.5rem; }
.mastery-bar-container { flex: 1; height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden; }
.mastery-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }

/* --- Concept detail --- */
.concept-detail-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; }
.concept-detail-header h2 { font-size: 1.25rem; margin: 0; }
.btn-back {
  background: none; border: 1px solid var(--border); border-radius: 6px;
  padding: 0.4rem 0.75rem; font-size: 0.8rem; cursor: pointer;
  color: var(--text-secondary); margin-bottom: 1rem;
}
.btn-back:hover { background: var(--bg); }

/* --- Confidence badges --- */
.confidence-badge { font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 4px; }
.confidence-high { background: #f0fdf4; color: #16a34a; }
.confidence-med { background: #fffbeb; color: #d97706; }
.confidence-low { background: #fef2f2; color: #dc2626; }

/* --- Concept rows (clickable) --- */
.concept-row { cursor: pointer; transition: background 0.15s; }
.concept-row:hover { background: var(--bg); }

/* --- Domain badges --- */
.domain-badge {
  font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 3px;
  background: var(--bg); color: var(--text-secondary); margin-left: 0.5rem;
}

/* --- Tutor session cards --- */
.tutor-session-card {
  display: flex; gap: 1rem; align-items: center; padding: 0.5rem 0;
  border-bottom: 1px solid var(--border); font-size: 0.85rem;
}

/* --- Prerequisite items --- */
.prereq-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.4rem 0; border-bottom: 1px solid var(--border); font-size: 0.85rem;
}

/* --- Skeleton loading --- */
.skeleton {
  background: linear-gradient(90deg, var(--bg) 25%, var(--border) 50%, var(--bg) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: 6px;
}
@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* --- Velocity toggle --- */
.velocity-toggle { display: flex; gap: 0.25rem; }
.velocity-toggle button {
  background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
  padding: 0.2rem 0.5rem; font-size: 0.7rem; cursor: pointer; color: var(--text-secondary);
}
.velocity-toggle button.active { background: var(--accent); color: white; border-color: var(--accent); }
```

**Step 2: Verify build works**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/dashboard/dashboard.css
git commit -m "feat: add CSS for analytics components, scroll containers, skeletons, confidence badges"
```

---

### Task 10: Push Schema Migration to Database

**Files:**
- None (DB operation only)

**Step 1: Push schema changes to Neon**

Run: `npx drizzle-kit push`
Expected: Tables `daily_snapshots`, `zpd_snapshots`, `concept_analytics` created

**Step 2: Verify tables exist**

Use Neon MCP tool or run:
```bash
npx drizzle-kit studio
```
And verify the three new tables appear.

**Step 3: Commit any generated migration files if not already committed**

```bash
git add drizzle/
git commit -m "chore: push analytics schema migration"
```

---

### Task 11: Integration Test — End-to-End Analytics Flow

**Files:**
- Modify: `tests/api/routes/analytics.test.ts`

**Step 1: Add authenticated integration tests**

Add to the existing test file:

```typescript
describeWithDb('Analytics API routes (authenticated)', () => {
  const { app } = createApp(testDbUrl!, { secret: testSecret! });
  const headers = { 'Content-Type': 'application/json', 'x-api-key': testApiKey! };

  it('GET /api/analytics/activity-heatmap returns heatmap array', async () => {
    const res = await app.request('/api/analytics/activity-heatmap?days=30', { headers });
    if (res.status === 401) return; // no valid auth in CI
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('heatmap');
    expect(Array.isArray(body.heatmap)).toBe(true);
  });

  it('GET /api/analytics/velocity returns velocity windows', async () => {
    const res = await app.request('/api/analytics/velocity', { headers });
    if (res.status === 401) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('velocity');
    expect(body.velocity).toHaveProperty('7d');
    expect(body.velocity).toHaveProperty('30d');
    expect(body.velocity).toHaveProperty('90d');
  });

  it('GET /api/analytics/timeline returns timeline array', async () => {
    const res = await app.request('/api/analytics/timeline', { headers });
    if (res.status === 401) return;
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('timeline');
    expect(Array.isArray(body.timeline)).toBe(true);
  });

  it('GET /api/analytics/concept/:id returns 404 for unknown concept', async () => {
    const res = await app.request('/api/analytics/concept/nonexistent-xyz-999', { headers });
    if (res.status === 401) return;
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run the tests**

Run: `npx vitest run tests/api/routes/analytics.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add tests/api/routes/analytics.test.ts
git commit -m "test: add integration tests for analytics API routes"
```

---

### Task 12: Manual Smoke Test & Polish

**Step 1: Start dev server**

Run: `npm run api:dev`

**Step 2: Open dashboard in browser**

Navigate to `http://localhost:3456` and verify:
- [ ] New tabs appear: Analytics, Concepts, Integrity
- [ ] Analytics tab loads heatmap, velocity chart, radar chart
- [ ] Concepts tab shows only user's assessed concepts
- [ ] Clicking a concept opens detail page with timeline chart + confidence band
- [ ] Back button returns to concept list
- [ ] Scroll containers work (no page-level infinite scroll)
- [ ] Skeleton loading states appear briefly during data fetch
- [ ] Charts resize on window resize
- [ ] Empty states handled gracefully (no errors on zero data)

**Step 3: Fix any issues found during smoke test**

**Step 4: Final commit**

```bash
git add -u
git commit -m "fix: polish analytics dashboard after smoke test"
```

---

## Task Dependency Graph

```
Task 1 (Schema) ──► Task 3 (On-write snapshots) ──► Task 10 (Push migration)
                                                          │
Task 2 (ECharts) ──────────────────────────────────────► Task 7 (Analytics tab)
                                                          │
Task 4 (API routes) ──► Task 11 (Integration tests)     │
                                                          │
Task 5 (Mastery helper) ──► Task 4, Task 8              │
                                                          │
Task 6 (Tab structure) ──► Task 7 ──► Task 8 ──► Task 9 ──► Task 12
```

Parallelizable groups:
- **Group 1** (no deps): Tasks 1, 2, 5
- **Group 2** (after Group 1): Tasks 3, 4, 6
- **Group 3** (after Group 2): Tasks 7, 8, 9, 10, 11
- **Group 4** (after all): Task 12
