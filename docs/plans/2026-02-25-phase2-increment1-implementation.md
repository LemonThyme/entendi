# Phase 2 Increment 1: Database + API Foundation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up Neon PostgreSQL with Drizzle ORM, create the database schema, seed the taxonomy, and build a basic Hono API that serves concept and mastery data.

**Architecture:** Drizzle schema definitions mirror the existing TypeScript types. Neon serverless driver connects over HTTP. Hono API exposes REST endpoints that the MCP server will call in Increment 2. Core math (probabilistic model, FSRS) stays unchanged and is imported by the API.

**Tech Stack:** Drizzle ORM, @neondatabase/serverless, Hono, Neon PostgreSQL, Vitest

---

### Task 1: Install Dependencies and Configure Neon

**Files:**
- Modify: `package.json`
- Create: `drizzle.config.ts`
- Create: `.env.example`

**Step 1: Install Drizzle, Neon driver, and dotenv**

```bash
npm install drizzle-orm @neondatabase/serverless
npm install -D drizzle-kit dotenv
```

**Step 2: Create drizzle.config.ts**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/api/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Step 3: Create .env.example**

```
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/entendi?sslmode=require
```

**Step 4: Add .env to .gitignore** (verify it's already there)

**Step 5: Create a Neon project and database**

Use the Neon MCP tools to create a project named `entendi` and get the connection string. Store it in `.env`.

**Step 6: Add scripts to package.json**

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:push": "drizzle-kit push",
"db:studio": "drizzle-kit studio",
"api:dev": "tsx src/api/index.ts"
```

**Step 7: Commit**

```bash
git add package.json package-lock.json drizzle.config.ts .env.example
git commit -m "chore: add Drizzle ORM and Neon driver dependencies"
```

---

### Task 2: Define Drizzle Schema

**Files:**
- Create: `src/api/db/schema.ts`
- Test: `tests/api/db/schema.test.ts`

**Step 1: Write the Drizzle schema**

Create `src/api/db/schema.ts` with all tables from the design doc:

```typescript
import { pgTable, text, real, integer, smallint, boolean, timestamp, jsonb, primaryKey, index, serial } from 'drizzle-orm/pg-core';

// --- Concepts ---

export const concepts = pgTable('concepts', {
  id: text('id').primaryKey(),
  aliases: text('aliases').array().notNull().default([]),
  domain: text('domain').notNull(),
  specificity: text('specificity').notNull(),
  parentId: text('parent_id').references(() => concepts.id),
  discrimination: real('discrimination').notNull().default(1.0),
  threshold1: real('threshold_1').notNull().default(-1.0),
  threshold2: real('threshold_2').notNull().default(0.0),
  threshold3: real('threshold_3').notNull().default(1.0),
  lifecycle: text('lifecycle').notNull().default('discovered'),
  popMeanMastery: real('pop_mean_mastery').notNull().default(0.0),
  popAssessmentCount: integer('pop_assessment_count').notNull().default(0),
  popFailureRate: real('pop_failure_rate').notNull().default(0.0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conceptEdges = pgTable('concept_edges', {
  sourceId: text('source_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  edgeType: text('edge_type').notNull(),
}, (table) => [
  primaryKey({ columns: [table.sourceId, table.targetId, table.edgeType] }),
  index('idx_concept_edges_target').on(table.targetId),
]);

// --- User Mastery State ---

export const userConceptStates = pgTable('user_concept_states', {
  userId: text('user_id').notNull(),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  mu: real('mu').notNull().default(0.0),
  sigma: real('sigma').notNull().default(1.5),
  stability: real('stability').notNull().default(1.0),
  difficulty: real('difficulty').notNull().default(5.0),
  lastAssessed: timestamp('last_assessed', { withTimezone: true }),
  assessmentCount: integer('assessment_count').notNull().default(0),
  tutoredCount: integer('tutored_count').notNull().default(0),
  untutoredCount: integer('untutored_count').notNull().default(0),
  muUntutored: real('mu_untutored').notNull().default(0.0),
  sigmaUntutored: real('sigma_untutored').notNull().default(1.5),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.conceptId] }),
]);

// --- Assessment Events (append-only) ---

export const assessmentEvents = pgTable('assessment_events', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  conceptId: text('concept_id').notNull(),
  eventType: text('event_type').notNull(),
  rubricScore: smallint('rubric_score').notNull(),
  evaluatorConfidence: real('evaluator_confidence').notNull(),
  muBefore: real('mu_before').notNull(),
  muAfter: real('mu_after').notNull(),
  probeDepth: smallint('probe_depth').notNull(),
  tutored: boolean('tutored').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_assessment_events_user_concept').on(table.userId, table.conceptId),
  index('idx_assessment_events_created').on(table.createdAt),
]);

// --- Sessions ---

export const tutorSessions = pgTable('tutor_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  conceptId: text('concept_id').notNull().references(() => concepts.id),
  phase: text('phase').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  triggerScore: smallint('trigger_score'),
  phase1Score: smallint('phase1_score'),
  phase4Score: smallint('phase4_score'),
  lastMisconception: text('last_misconception'),
});

export const tutorExchanges = pgTable('tutor_exchanges', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => tutorSessions.id, { onDelete: 'cascade' }),
  phase: text('phase').notNull(),
  question: text('question').notNull(),
  response: text('response'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const probeSessions = pgTable('probe_sessions', {
  userId: text('user_id').primaryKey(),
  pendingConceptId: text('pending_concept_id').references(() => concepts.id),
  pendingProbeData: jsonb('pending_probe_data'),
  lastProbeTime: timestamp('last_probe_time', { withTimezone: true }),
  probesThisSession: integer('probes_this_session').notNull().default(0),
});

export const pendingActions = pgTable('pending_actions', {
  userId: text('user_id').primaryKey(),
  actionType: text('action_type').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

**Step 2: Write a schema validation test**

Create `tests/api/db/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { concepts, conceptEdges, userConceptStates, assessmentEvents, tutorSessions, tutorExchanges, probeSessions, pendingActions } from '../../../src/api/db/schema.js';
import { getTableName } from 'drizzle-orm';

describe('Drizzle schema', () => {
  it('defines all 8 tables', () => {
    const tables = [concepts, conceptEdges, userConceptStates, assessmentEvents, tutorSessions, tutorExchanges, probeSessions, pendingActions];
    expect(tables).toHaveLength(8);
    tables.forEach(t => expect(getTableName(t)).toBeDefined());
  });

  it('concepts table has correct name', () => {
    expect(getTableName(concepts)).toBe('concepts');
  });

  it('concept_edges has composite primary key', () => {
    expect(getTableName(conceptEdges)).toBe('concept_edges');
  });

  it('user_concept_states has composite primary key', () => {
    expect(getTableName(userConceptStates)).toBe('user_concept_states');
  });

  it('assessment_events has serial primary key', () => {
    expect(getTableName(assessmentEvents)).toBe('assessment_events');
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run tests/api/db/schema.test.ts`
Expected: PASS

**Step 4: Generate migration**

Run: `npx drizzle-kit generate`
Expected: Migration SQL files created in `drizzle/` directory

**Step 5: Commit**

```bash
git add src/api/db/schema.ts tests/api/db/schema.test.ts drizzle/
git commit -m "feat: define Drizzle schema for all 8 tables"
```

---

### Task 3: Database Connection and Migration

**Files:**
- Create: `src/api/db/connection.ts`
- Create: `src/api/db/migrate.ts`

**Step 1: Create connection module**

Create `src/api/db/connection.ts`:

```typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDb>;
```

**Step 2: Create migration runner**

Create `src/api/db/migrate.ts`:

```typescript
import { config } from 'dotenv';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { createDb } from './connection.js';

config();

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations complete.');
}

main().catch(console.error);
```

**Step 3: Run migration against Neon**

Run: `npx tsx src/api/db/migrate.ts`
Expected: Tables created in Neon database

**Step 4: Verify with Drizzle Studio**

Run: `npx drizzle-kit studio`
Expected: Opens browser with all 8 tables visible

**Step 5: Add migrate script to package.json**

```json
"db:migrate:run": "tsx src/api/db/migrate.ts"
```

**Step 6: Commit**

```bash
git add src/api/db/connection.ts src/api/db/migrate.ts package.json
git commit -m "feat: add database connection and migration runner"
```

---

### Task 4: Seed Taxonomy Loader

**Files:**
- Create: `src/api/db/seed.ts`
- Test: `tests/api/db/seed.test.ts`

**Step 1: Write seed loader**

Create `src/api/db/seed.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { concepts, conceptEdges } from './schema.js';
import { buildSeedConceptNodes } from '../../config/seed-taxonomy.js';
import type { Database } from './connection.js';

export async function seedTaxonomy(db: Database) {
  const seedConcepts = buildSeedConceptNodes();
  const conceptIds = Object.keys(seedConcepts);

  // Upsert concepts
  for (const [id, node] of Object.entries(seedConcepts)) {
    await db.insert(concepts).values({
      id: node.conceptId,
      aliases: node.aliases,
      domain: node.domain,
      specificity: node.specificity,
      parentId: node.parentConcept,
      discrimination: node.itemParams.discrimination,
      threshold1: node.itemParams.thresholds[0],
      threshold2: node.itemParams.thresholds[1],
      threshold3: node.itemParams.thresholds[2],
      lifecycle: node.lifecycle,
      popMeanMastery: node.populationStats.meanMastery,
      popAssessmentCount: node.populationStats.assessmentCount,
      popFailureRate: node.populationStats.failureRate,
    }).onConflictDoNothing();
  }

  // Insert edges (after all concepts exist)
  for (const [id, node] of Object.entries(seedConcepts)) {
    for (const edge of node.relationships) {
      // Only insert edge if target concept exists in seed
      if (conceptIds.includes(edge.target)) {
        await db.insert(conceptEdges).values({
          sourceId: node.conceptId,
          targetId: edge.target,
          edgeType: edge.type,
        }).onConflictDoNothing();
      }
    }
  }

  return { conceptCount: conceptIds.length };
}
```

**Step 2: Write test**

Create `tests/api/db/seed.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSeedConceptNodes } from '../../../src/config/seed-taxonomy.js';

describe('seed taxonomy data', () => {
  it('produces concept nodes with required fields', () => {
    const seeds = buildSeedConceptNodes();
    const ids = Object.keys(seeds);
    expect(ids.length).toBeGreaterThan(100);

    for (const node of Object.values(seeds)) {
      expect(node.conceptId).toBeDefined();
      expect(node.domain).toBeDefined();
      expect(['domain', 'topic', 'technique']).toContain(node.specificity);
      expect(node.itemParams.discrimination).toBeGreaterThan(0);
      expect(node.itemParams.thresholds).toHaveLength(3);
      expect(node.lifecycle).toBe('stable');
    }
  });

  it('all relationship targets exist in seed set', () => {
    const seeds = buildSeedConceptNodes();
    const ids = new Set(Object.keys(seeds));

    for (const node of Object.values(seeds)) {
      for (const edge of node.relationships) {
        expect(ids.has(edge.target)).toBe(true);
      }
    }
  });
});
```

**Step 3: Run test**

Run: `npx vitest run tests/api/db/seed.test.ts`
Expected: PASS

**Step 4: Create CLI seed runner**

Add to `src/api/db/seed.ts`:

```typescript
// CLI entry point
async function main() {
  const { config } = await import('dotenv');
  config();
  const { createDb } = await import('./connection.js');
  const db = createDb(process.env.DATABASE_URL!);
  console.log('Seeding taxonomy...');
  const result = await seedTaxonomy(db);
  console.log(`Seeded ${result.conceptCount} concepts.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch(console.error);
}
```

**Step 5: Run seed against Neon**

Run: `npx tsx src/api/db/seed.ts`
Expected: "Seeded 137 concepts."

**Step 6: Add seed script to package.json**

```json
"db:seed": "tsx src/api/db/seed.ts"
```

**Step 7: Commit**

```bash
git add src/api/db/seed.ts tests/api/db/seed.test.ts package.json
git commit -m "feat: add taxonomy seed loader for Neon"
```

---

### Task 5: Hono API Skeleton with Concept Routes

**Files:**
- Create: `src/api/index.ts`
- Create: `src/api/routes/concepts.ts`
- Create: `src/api/routes/mastery.ts`
- Test: `tests/api/routes/concepts.test.ts`

**Step 1: Create the Hono app entry point**

Create `src/api/index.ts`:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { conceptRoutes } from './routes/concepts.js';
import { masteryRoutes } from './routes/mastery.js';
import { createDb, type Database } from './db/connection.js';

export type Env = {
  Variables: {
    db: Database;
  };
};

export function createApp(databaseUrl: string) {
  const app = new Hono<Env>();
  const db = createDb(databaseUrl);

  // Middleware
  app.use('*', cors());
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Routes
  app.route('/api/concepts', conceptRoutes);
  app.route('/api/mastery', masteryRoutes);

  return app;
}

// Dev server
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const { config } = await import('dotenv');
  config();
  const { serve } = await import('@hono/node-server');
  const app = createApp(process.env.DATABASE_URL!);
  serve({ fetch: app.fetch, port: 3456 }, (info) => {
    console.log(`Entendi API running at http://localhost:${info.port}`);
  });
}
```

**Step 2: Create concept routes**

Create `src/api/routes/concepts.ts`:

```typescript
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { concepts, conceptEdges } from '../db/schema.js';
import type { Env } from '../index.js';

export const conceptRoutes = new Hono<Env>();

// List all concepts (with optional domain filter)
conceptRoutes.get('/', async (c) => {
  const db = c.get('db');
  const domain = c.req.query('domain');

  const query = domain
    ? db.select().from(concepts).where(eq(concepts.domain, domain))
    : db.select().from(concepts);

  const rows = await query;
  return c.json(rows);
});

// Get single concept with edges
conceptRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [concept] = await db.select().from(concepts).where(eq(concepts.id, id));
  if (!concept) return c.json({ error: 'Not found' }, 404);

  const edges = await db.select().from(conceptEdges).where(eq(conceptEdges.sourceId, id));
  return c.json({ ...concept, edges });
});

// Recursive prerequisites
conceptRoutes.get('/:id/prerequisites', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const result = await db.execute(sql`
    WITH RECURSIVE prereqs AS (
      SELECT target_id AS concept_id, 1 AS depth
      FROM concept_edges
      WHERE source_id = ${id} AND edge_type = 'requires'
      UNION ALL
      SELECT e.target_id, p.depth + 1
      FROM concept_edges e
      JOIN prereqs p ON e.source_id = p.concept_id
      WHERE e.edge_type = 'requires' AND p.depth < 10
    )
    SELECT DISTINCT concept_id, MIN(depth) as depth FROM prereqs GROUP BY concept_id ORDER BY depth
  `);

  return c.json(result.rows);
});
```

**Step 3: Create mastery routes**

Create `src/api/routes/mastery.ts`:

```typescript
import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { userConceptStates, assessmentEvents, concepts } from '../db/schema.js';
import type { Env } from '../index.js';

export const masteryRoutes = new Hono<Env>();

// Get all mastery states for a user
masteryRoutes.get('/', async (c) => {
  const db = c.get('db');
  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const states = await db.select().from(userConceptStates)
    .where(eq(userConceptStates.userId, userId));
  return c.json(states);
});

// Get mastery for a specific concept
masteryRoutes.get('/:conceptId', async (c) => {
  const db = c.get('db');
  const userId = c.req.query('userId');
  const conceptId = c.req.param('conceptId');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const [state] = await db.select().from(userConceptStates)
    .where(and(
      eq(userConceptStates.userId, userId),
      eq(userConceptStates.conceptId, conceptId),
    ));

  if (!state) return c.json({ mu: 0, sigma: 1.5, assessmentCount: 0 });
  return c.json(state);
});

// Get assessment history for a concept
masteryRoutes.get('/:conceptId/history', async (c) => {
  const db = c.get('db');
  const userId = c.req.query('userId');
  const conceptId = c.req.param('conceptId');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const events = await db.select().from(assessmentEvents)
    .where(and(
      eq(assessmentEvents.userId, userId),
      eq(assessmentEvents.conceptId, conceptId),
    ))
    .orderBy(assessmentEvents.createdAt)
    .limit(50);

  return c.json(events);
});

// ZPD frontier
masteryRoutes.get('/zpd/frontier', async (c) => {
  const db = c.get('db');
  const userId = c.req.query('userId');
  const threshold = parseFloat(c.req.query('threshold') ?? '0.7');
  if (!userId) return c.json({ error: 'userId required' }, 400);

  const result = await db.execute(sql`
    SELECT c.id, c.domain, c.specificity, c.discrimination,
           c.threshold_1, c.threshold_2, c.threshold_3,
           COALESCE(ucs.mu, 0) AS mu,
           COALESCE(ucs.sigma, 1.5) AS sigma
    FROM concepts c
    LEFT JOIN user_concept_states ucs
      ON ucs.concept_id = c.id AND ucs.user_id = ${userId}
    WHERE (1.0 / (1.0 + EXP(-COALESCE(ucs.mu, 0)))) < ${threshold}
      AND NOT EXISTS (
        SELECT 1 FROM concept_edges ce
        LEFT JOIN user_concept_states pucs
          ON pucs.concept_id = ce.target_id AND pucs.user_id = ${userId}
        WHERE ce.source_id = c.id
          AND ce.edge_type = 'requires'
          AND (1.0 / (1.0 + EXP(-COALESCE(pucs.mu, 0)))) < ${threshold}
      )
    ORDER BY c.id
  `);

  return c.json(result.rows);
});
```

**Step 4: Write API integration tests**

Create `tests/api/routes/concepts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createApp } from '../../../src/api/index.js';

// Uses test database — set DATABASE_URL in env
const testDbUrl = process.env.DATABASE_URL;

describe('concept routes', () => {
  // Skip if no DATABASE_URL (CI without DB)
  const describeWithDb = testDbUrl ? describe : describe.skip;

  describeWithDb('with database', () => {
    const app = createApp(testDbUrl!);

    it('GET /health returns ok', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    it('GET /api/concepts returns array', async () => {
      const res = await app.request('/api/concepts');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('GET /api/concepts/:id returns 404 for missing', async () => {
      const res = await app.request('/api/concepts/nonexistent');
      expect(res.status).toBe(404);
    });

    it('GET /api/mastery requires userId', async () => {
      const res = await app.request('/api/mastery');
      expect(res.status).toBe(400);
    });
  });
});
```

**Step 5: Run tests**

Run: `npx vitest run tests/api/`
Expected: PASS (with DATABASE_URL set) or SKIP (without)

**Step 6: Test the dev server manually**

Run: `npm run api:dev`
Then: `curl http://localhost:3456/health`
Expected: `{"status":"ok"}`

Then: `curl http://localhost:3456/api/concepts | head -c 200`
Expected: JSON array of seeded concepts

**Step 7: Run full test suite**

Run: `npm test`
Expected: All existing tests + new tests pass

**Step 8: Commit**

```bash
git add src/api/ tests/api/
git commit -m "feat: add Hono API with concept and mastery routes"
```

---

### Task 6: Commit Design and Plan Docs

**Step 1: Commit docs**

```bash
git add docs/plans/2026-02-25-phase2-postgres-api-design.md docs/plans/2026-02-25-phase2-increment1-implementation.md
git commit -m "docs: Phase 2 design and increment 1 implementation plan"
```
