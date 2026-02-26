# Concept Graph: Normalization, Prerequisites, and Probe Selection

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the urgency-ranked probe selection with an information-theoretic system grounded in a normalized concept graph with automatic prerequisite discovery and embedding-based distance for conversational focus.

**Architecture:** Three-tier concept normalization on observe (deterministic → embedding similarity → LLM adjudication). New concepts trigger a one-time LLM enrichment call that infers canonical name, parent concept, and prerequisites. Probe selection replaces `sort by urgency` with `infoGain * conversationalRelevance` where relevance is computed via embedding cosine distance from the user's trunk concept.

**Tech Stack:** Cloudflare Workers AI (`bge-base-en-v1.5` embeddings), Anthropic Claude API (concept enrichment), Neon PostgreSQL (pgvector for embeddings), Drizzle ORM, Hono

**References:**
- GitHub Issues: #7 (probe selection), #8 (concept canonicalization)
- GENCAT (arXiv:2602.20020) — generative CAT with LLM responses
- arXiv:2507.18479 — zero-shot prerequisite prediction with LLMs
- sift-kg / KARMA — three-tier entity resolution pipeline

---

## Current State

The observe endpoint (`src/api/routes/mcp.ts:82-337`) does:
1. Insert concepts as-is (no normalization)
2. Build candidates with `probeUrgency()` (mastery gap 30% + uncertainty 40% + decay 30%)
3. Check prerequisite inconsistency (+0.2 boost)
4. **Sort by urgency, pick top** — no awareness of conversational focus
5. `triggerContext` only appended to guidance text, not used in selection

Problems:
- User discusses Thompson sampling → gets probed on A/B testing (higher urgency)
- `ab-testing` and `a-b-testing` are separate concepts
- No automatic prerequisite edges — graph is empty without manual setup

## Design

### 1. Schema Changes

**New table: `concept_embeddings`**

Stores the embedding vector for each concept's canonical ID. Separate table because pgvector columns are large and shouldn't bloat the main concepts table.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE concept_embeddings (
  concept_id TEXT PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
  embedding vector(768),  -- bge-base-en-v1.5 output dimension
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_concept_embeddings_ivfflat
  ON concept_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

**New table: `concept_aliases`**

Maps variant strings to canonical concept IDs. Populated by normalization and merge operations.

```sql
CREATE TABLE concept_aliases (
  alias TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_concept_aliases_canonical ON concept_aliases(canonical_id);
```

**Modify `concepts` table:**

Add `description` column for enrichment output (used in embedding generation).

```sql
ALTER TABLE concepts ADD COLUMN description TEXT NOT NULL DEFAULT '';
```

**Modify `concept_edges` table:**

Add `source` column to track how the edge was created (llm-inferred vs admin-curated vs data-driven).

```sql
ALTER TABLE concept_edges ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
-- Values: 'llm', 'manual', 'data'
```

### 2. Concept Normalization Pipeline

On every `POST /observe`, before inserting concepts:

**Tier 1: Deterministic normalization** (pure string manipulation, zero cost)
```
input:  "A/B Testing", "React.js Hooks", "CI/CD Pipeline"
output: "a-b-testing",  "react-js-hooks",  "ci-cd-pipeline"

Rules:
1. Lowercase
2. Replace /  .  _  spaces with -
3. Collapse consecutive -
4. Strip leading/trailing -
5. Truncate to 200 chars
```

**Tier 2: Embedding similarity** (Workers AI, ~5ms per concept)
```
1. Embed the normalized ID via Workers AI bge-base-en-v1.5
2. Query concept_embeddings for cosine > 0.9
3. If match found → resolve to existing canonical ID
4. Store embedding for new concepts
```

**Tier 3: LLM adjudication** (Claude API, only for borderline 0.75-0.9)
```
Prompt: "Are these the same technical concept?
  A: {incoming}  B: {existing}
  Reply YES or NO with one sentence of reasoning."

If YES → create alias, resolve to existing
If NO → insert as new concept
```

### 3. Concept Enrichment (New Concepts Only)

When a concept is genuinely new (passes all three tiers without matching):

```
POST to Claude API (claude-haiku-4-5 for cost efficiency):

"Given the technical concept '{concept_id}', provide:
1. canonical_name: the most standard name for this concept (kebab-case)
2. description: one sentence explaining what it is (for embedding)
3. parent: the broader concept this belongs to (kebab-case, or null)
4. prerequisites: direct prerequisites needed to understand this (array of kebab-case IDs, max 5)

Respond as JSON."
```

Result is cached permanently. Creates:
- `concepts.description` update
- `concept_edges` entries (type: 'requires', source: 'llm')
- `concepts.parentId` update
- Prerequisite concepts created if they don't exist (with their own enrichment queued)

**Cost:** ~$0.001 per new concept with Haiku. One-time per concept ever.

### 4. Probe Selection: Information-Theoretic + Conversational Focus

Replace the current `sort by urgency, pick top` (mcp.ts:196) with:

**New observe schema field:**
```typescript
const observeSchema = z.object({
  concepts: z.array(z.object({
    id: z.string().min(1).max(200),
    source: z.enum(['package', 'ast', 'llm']),
  })).min(1).max(50),
  triggerContext: z.string().max(1000).default(''),
  primaryConceptId: z.string().max(200).optional(),  // NEW
});
```

**Selection formula:**

```
For each candidate concept c:

  infoGain(c) = expectedPosteriorVarianceReduction(c)
              = sigma_c^2 - E[sigma_c'^2 | probe]

  relevance(c) = 1 / (1 + embeddingDistance(c, trunk))
    where trunk = primaryConceptId from observe request
    embeddingDistance = 1 - cosineSimilarity(embedding_c, embedding_trunk)

  score(c) = infoGain(c) * relevance(c)

Select: argmax_c score(c)
```

When `primaryConceptId` is not set, `relevance = 1.0` for all candidates (degrades to pure info gain).

**Expected posterior variance reduction** approximated via Fisher information:
```
infoGain ≈ sigma^2 - 1/(1/sigma^2 + fisherInfo)
```
This is already computed — `fisherInfo` via `grmFisherInformation()` exists in the current code.

### 5. Skill Update

Update `plugin/skills/concept-detection/SKILL.md` to:
- Pass `primaryConceptId` — the concept the user most directly referenced
- Be more conservative about inferring secondary concepts (only pass concepts explicitly mentioned)

### 6. Workers AI Binding

Add to `wrangler.toml`:
```toml
[ai]
binding = "AI"
```

Access in Hono via `c.env.AI` (Cloudflare Workers AI binding).

### 7. Fallback for Local Dev

Workers AI only works deployed. For `npm run api:dev`:
- Skip embedding similarity (tier 2) — fall through to tier 3 or insert as-is
- Use `ANTHROPIC_API_KEY` env var for enrichment calls
- Log a warning when embeddings are unavailable

---

## Implementation Plan

### Task 1: Schema Migration — New Tables and Columns

**Files:**
- Modify: `src/api/db/schema.ts`
- Create: `src/api/db/migrations/0001_concept_graph.sql`

**Step 1: Add new tables and columns to Drizzle schema**

In `src/api/db/schema.ts`, after the `concepts` table (line 126):

```typescript
// After concepts table, add:
export const conceptEmbeddings = pgTable('concept_embeddings', {
  conceptId: text('concept_id').primaryKey().references(() => concepts.id, { onDelete: 'cascade' }),
  embedding: text('embedding').notNull(), // JSON-serialized float array (pgvector via raw SQL)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conceptAliases = pgTable('concept_aliases', {
  alias: text('alias').primaryKey(),
  canonicalId: text('canonical_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_concept_aliases_canonical').on(table.canonicalId),
]);
```

Add `description` column to `concepts` table:
```typescript
description: text('description').notNull().default(''),
```

Add `source` column to `conceptEdges` table:
```typescript
source: text('source').notNull().default('manual'),
```

**Step 2: Write migration SQL**

Create `src/api/db/migrations/0001_concept_graph.sql`:

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Concept embeddings (bge-base-en-v1.5 = 768 dimensions)
CREATE TABLE IF NOT EXISTS concept_embeddings (
  concept_id TEXT PRIMARY KEY REFERENCES concepts(id) ON DELETE CASCADE,
  embedding vector(768) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IVFFlat index for cosine similarity search
-- Note: requires at least 100 rows to build; will be created after initial population
-- CREATE INDEX idx_concept_embeddings_ivfflat
--   ON concept_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Concept aliases for normalization
CREATE TABLE IF NOT EXISTS concept_aliases (
  alias TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_concept_aliases_canonical ON concept_aliases(canonical_id);

-- Add description to concepts
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- Add source to concept_edges
ALTER TABLE concept_edges ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
```

**Step 3: Run migration against Neon**

```bash
# Via Neon MCP or psql
# Run the SQL from 0001_concept_graph.sql against the Neon database
```

**Step 4: Commit**

```bash
git add src/api/db/schema.ts src/api/db/migrations/
git commit -m "feat: add concept_embeddings, concept_aliases tables and concept description/edge source columns"
```

---

### Task 2: Deterministic Concept Normalization

**Files:**
- Create: `src/api/lib/concept-normalize.ts`
- Create: `tests/api/concept-normalize.test.ts`

**Step 1: Write failing tests**

```typescript
// tests/api/concept-normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeConcept } from '../../src/api/lib/concept-normalize.js';

describe('normalizeConcept', () => {
  it('lowercases', () => {
    expect(normalizeConcept('React-Hooks')).toBe('react-hooks');
  });

  it('replaces / . _ spaces with -', () => {
    expect(normalizeConcept('A/B Testing')).toBe('a-b-testing');
    expect(normalizeConcept('React.js')).toBe('react-js');
    expect(normalizeConcept('ci_cd_pipeline')).toBe('ci-cd-pipeline');
    expect(normalizeConcept('thompson sampling')).toBe('thompson-sampling');
  });

  it('collapses consecutive dashes', () => {
    expect(normalizeConcept('a--b---c')).toBe('a-b-c');
  });

  it('strips leading/trailing dashes', () => {
    expect(normalizeConcept('-react-hooks-')).toBe('react-hooks');
  });

  it('truncates to 200 chars', () => {
    const long = 'a'.repeat(250);
    expect(normalizeConcept(long).length).toBe(200);
  });

  it('handles already-normalized input', () => {
    expect(normalizeConcept('thompson-sampling')).toBe('thompson-sampling');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/api/concept-normalize.test.ts
```

Expected: FAIL (module not found)

**Step 3: Implement normalization**

```typescript
// src/api/lib/concept-normalize.ts

/**
 * Deterministic concept ID normalization.
 * Tier 1 of the three-tier normalization pipeline.
 */
export function normalizeConcept(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\/\.\_ ]/g, '-')   // replace / . _ space with -
    .replace(/-{2,}/g, '-')        // collapse consecutive -
    .replace(/^-|-$/g, '')         // strip leading/trailing -
    .slice(0, 200);                // truncate
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/api/concept-normalize.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/api/lib/concept-normalize.ts tests/api/concept-normalize.test.ts
git commit -m "feat: add deterministic concept normalization (tier 1)"
```

---

### Task 3: Alias Resolution

**Files:**
- Modify: `src/api/lib/concept-normalize.ts`
- Modify: `tests/api/concept-normalize.test.ts`

**Step 1: Write failing tests for alias resolution**

```typescript
// Add to tests/api/concept-normalize.test.ts
import { resolveConceptId } from '../../src/api/lib/concept-normalize.js';

describe('resolveConceptId', () => {
  it('returns canonical ID if alias exists', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => [{ canonicalId: 'a-b-testing' }],
        }),
      }),
    };
    const result = await resolveConceptId(mockDb as any, 'ab-testing');
    expect(result).toBe('a-b-testing');
  });

  it('returns normalized input if no alias exists', async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => [],
        }),
      }),
    };
    const result = await resolveConceptId(mockDb as any, 'Thompson Sampling');
    expect(result).toBe('thompson-sampling');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/api/concept-normalize.test.ts
```

**Step 3: Implement alias resolution**

```typescript
// Add to src/api/lib/concept-normalize.ts
import { eq } from 'drizzle-orm';
import { conceptAliases } from '../db/schema.js';
import type { Database } from '../db/connection.js';

/**
 * Resolve a concept ID through normalization + alias lookup.
 * Returns the canonical concept ID.
 */
export async function resolveConceptId(db: Database, raw: string): Promise<string> {
  const normalized = normalizeConcept(raw);

  // Check alias table
  const [alias] = await db.select({ canonicalId: conceptAliases.canonicalId })
    .from(conceptAliases)
    .where(eq(conceptAliases.alias, normalized));

  return alias?.canonicalId ?? normalized;
}
```

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git add src/api/lib/concept-normalize.ts tests/api/concept-normalize.test.ts
git commit -m "feat: add alias resolution for concept normalization"
```

---

### Task 4: Workers AI Embedding Binding

**Files:**
- Modify: `wrangler.toml`
- Modify: `src/api/index.ts` (Env type)
- Create: `src/api/lib/embeddings.ts`
- Create: `tests/api/embeddings.test.ts`

**Step 1: Add Workers AI binding to wrangler.toml**

```toml
[ai]
binding = "AI"
```

**Step 2: Update Env type in `src/api/index.ts`**

Add `AI` to the Cloudflare env bindings so it's available via `c.env.AI`.

**Step 3: Write embeddings module**

```typescript
// src/api/lib/embeddings.ts
import { eq, sql } from 'drizzle-orm';
import { conceptEmbeddings } from '../db/schema.js';
import type { Database } from '../db/connection.js';

export interface EmbeddingResult {
  conceptId: string;
  similarity: number;
}

/**
 * Generate an embedding for a concept using Workers AI.
 * Returns null if Workers AI is not available (local dev).
 */
export async function embedConcept(ai: any, conceptId: string): Promise<number[] | null> {
  if (!ai) return null;
  try {
    const result = await ai.run('@cf/baai/bge-base-en-v1.5', {
      text: [conceptId.replace(/-/g, ' ')],
    });
    return result?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Find similar concepts by embedding cosine similarity.
 * Uses pgvector's cosine distance operator.
 */
export async function findSimilarConcepts(
  db: Database,
  embedding: number[],
  threshold: number = 0.9,
  limit: number = 5,
): Promise<EmbeddingResult[]> {
  const embeddingStr = `[${embedding.join(',')}]`;
  const rows = await db.execute(sql`
    SELECT concept_id, 1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM concept_embeddings
    WHERE 1 - (embedding <=> ${embeddingStr}::vector) > ${threshold}
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `);
  return (rows.rows || []).map((r: any) => ({
    conceptId: r.concept_id,
    similarity: r.similarity,
  }));
}

/**
 * Store a concept embedding.
 */
export async function storeEmbedding(
  db: Database,
  conceptId: string,
  embedding: number[],
): Promise<void> {
  const embeddingStr = `[${embedding.join(',')}]`;
  await db.execute(sql`
    INSERT INTO concept_embeddings (concept_id, embedding)
    VALUES (${conceptId}, ${embeddingStr}::vector)
    ON CONFLICT (concept_id) DO UPDATE SET embedding = ${embeddingStr}::vector
  `);
}

/**
 * Get the cosine similarity between two concepts.
 * Returns 0 if either concept has no embedding.
 */
export async function conceptSimilarity(
  db: Database,
  conceptA: string,
  conceptB: string,
): Promise<number> {
  if (conceptA === conceptB) return 1.0;
  const rows = await db.execute(sql`
    SELECT 1 - (a.embedding <=> b.embedding) AS similarity
    FROM concept_embeddings a, concept_embeddings b
    WHERE a.concept_id = ${conceptA} AND b.concept_id = ${conceptB}
  `);
  return (rows.rows?.[0] as any)?.similarity ?? 0;
}
```

**Step 4: Write tests with mocked Workers AI**

```typescript
// tests/api/embeddings.test.ts
import { describe, it, expect, vi } from 'vitest';
import { embedConcept } from '../../src/api/lib/embeddings.js';

describe('embedConcept', () => {
  it('returns null when AI binding is not available', async () => {
    const result = await embedConcept(null, 'thompson-sampling');
    expect(result).toBeNull();
  });

  it('returns embedding array from Workers AI', async () => {
    const mockAi = {
      run: vi.fn().mockResolvedValue({ data: [new Array(768).fill(0.1)] }),
    };
    const result = await embedConcept(mockAi, 'thompson-sampling');
    expect(result).toHaveLength(768);
    expect(mockAi.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', {
      text: ['thompson sampling'],
    });
  });
});
```

**Step 5: Run tests, verify pass**

**Step 6: Commit**

```bash
git add wrangler.toml src/api/lib/embeddings.ts src/api/index.ts tests/api/embeddings.test.ts
git commit -m "feat: add Workers AI embedding generation and pgvector similarity search"
```

---

### Task 5: Concept Enrichment via Claude API

**Files:**
- Create: `src/api/lib/concept-enrichment.ts`
- Create: `tests/api/concept-enrichment.test.ts`

**Step 1: Write enrichment module**

```typescript
// src/api/lib/concept-enrichment.ts
import Anthropic from '@anthropic-ai/sdk';
import type { Database } from '../db/connection.js';
import { concepts, conceptEdges } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface EnrichmentResult {
  canonicalName: string;
  description: string;
  parent: string | null;
  prerequisites: string[];
}

const ENRICHMENT_PROMPT = `Given the technical concept "{concept}", provide:
1. canonical_name: the most standard name for this concept (kebab-case, e.g. "thompson-sampling")
2. description: one sentence explaining what it is
3. parent: the broader concept this belongs to (kebab-case), or null if top-level
4. prerequisites: direct prerequisites needed to understand this (array of kebab-case IDs, max 5)

Respond ONLY with a JSON object, no markdown.`;

/**
 * Enrich a new concept with metadata via Claude API.
 * Returns null if ANTHROPIC_API_KEY is not configured.
 */
export async function enrichConcept(conceptId: string): Promise<EnrichmentResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: ENRICHMENT_PROMPT.replace('{concept}', conceptId.replace(/-/g, ' ')),
    }],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
  try {
    const parsed = JSON.parse(text);
    return {
      canonicalName: String(parsed.canonical_name || conceptId),
      description: String(parsed.description || ''),
      parent: parsed.parent ? String(parsed.parent) : null,
      prerequisites: Array.isArray(parsed.prerequisites)
        ? parsed.prerequisites.map(String).slice(0, 5)
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Apply enrichment results to the database.
 * Creates prerequisite edges, updates description, sets parent.
 */
export async function applyEnrichment(
  db: Database,
  conceptId: string,
  enrichment: EnrichmentResult,
): Promise<void> {
  // Update concept description
  await db.update(concepts)
    .set({ description: enrichment.description })
    .where(eq(concepts.id, conceptId));

  // Set parent if provided
  if (enrichment.parent) {
    // Ensure parent concept exists
    const [existing] = await db.select({ id: concepts.id })
      .from(concepts).where(eq(concepts.id, enrichment.parent));
    if (!existing) {
      await db.insert(concepts).values({
        id: enrichment.parent,
        domain: 'general',
        specificity: 'topic',
      }).onConflictDoNothing();
    }
    await db.update(concepts)
      .set({ parentId: enrichment.parent })
      .where(eq(concepts.id, conceptId));
  }

  // Create prerequisite edges
  for (const prereqId of enrichment.prerequisites) {
    // Ensure prerequisite concept exists
    await db.insert(concepts).values({
      id: prereqId,
      domain: 'general',
      specificity: 'topic',
    }).onConflictDoNothing();

    // Create edge: conceptId requires prereqId
    await db.insert(conceptEdges).values({
      sourceId: conceptId,
      targetId: prereqId,
      edgeType: 'requires',
      source: 'llm',
    }).onConflictDoNothing();
  }
}
```

**Step 2: Write tests with mocked Claude API**

Test the prompt parsing, error handling, and database application logic.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add src/api/lib/concept-enrichment.ts tests/api/concept-enrichment.test.ts
git commit -m "feat: add LLM-based concept enrichment with prerequisite discovery"
```

---

### Task 6: Three-Tier Normalization Pipeline (Integrated)

**Files:**
- Create: `src/api/lib/concept-pipeline.ts`
- Create: `tests/api/concept-pipeline.test.ts`

This is the orchestrator that combines tier 1 (deterministic), tier 2 (embedding), tier 3 (LLM adjudication), and enrichment into a single function called from the observe endpoint.

**Step 1: Write pipeline module**

```typescript
// src/api/lib/concept-pipeline.ts
import type { Database } from '../db/connection.js';
import { normalizeConcept, resolveConceptId } from './concept-normalize.js';
import { embedConcept, findSimilarConcepts, storeEmbedding } from './embeddings.js';
import { enrichConcept, applyEnrichment } from './concept-enrichment.js';
import { concepts, conceptAliases } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface ResolvedConcept {
  canonicalId: string;
  isNew: boolean;
}

/**
 * Full three-tier concept resolution pipeline.
 * 1. Deterministic normalization
 * 2. Alias lookup
 * 3. Embedding similarity (if AI binding available)
 * 4. Insert as new + trigger enrichment (if no match)
 */
export async function resolveConcept(
  db: Database,
  rawId: string,
  ai?: any,
): Promise<ResolvedConcept> {
  // Tier 1: Deterministic normalization
  const normalized = normalizeConcept(rawId);

  // Check alias table first
  const aliasResolved = await resolveConceptId(db, rawId);
  if (aliasResolved !== normalized) {
    return { canonicalId: aliasResolved, isNew: false };
  }

  // Check if concept already exists
  const [existing] = await db.select({ id: concepts.id })
    .from(concepts).where(eq(concepts.id, normalized));
  if (existing) {
    return { canonicalId: normalized, isNew: false };
  }

  // Tier 2: Embedding similarity
  const embedding = await embedConcept(ai, normalized);
  if (embedding) {
    const similar = await findSimilarConcepts(db, embedding, 0.9, 1);
    if (similar.length > 0) {
      // Found a match — create alias and resolve
      await db.insert(conceptAliases).values({
        alias: normalized,
        canonicalId: similar[0].conceptId,
      }).onConflictDoNothing();
      return { canonicalId: similar[0].conceptId, isNew: false };
    }
  }

  // No match — insert as new concept
  await db.insert(concepts).values({
    id: normalized,
    domain: 'general',
    specificity: 'topic',
  }).onConflictDoNothing();

  // Store embedding for future similarity searches
  if (embedding) {
    await storeEmbedding(db, normalized, embedding);
  }

  // Trigger enrichment (non-blocking — don't wait for it)
  enrichConcept(normalized).then(async (result) => {
    if (result) {
      await applyEnrichment(db, normalized, result);
      // Also embed the description for better future matches
      if (ai && result.description) {
        const descEmbedding = await embedConcept(ai, `${normalized}: ${result.description}`);
        if (descEmbedding) {
          await storeEmbedding(db, normalized, descEmbedding);
        }
      }
    }
  }).catch(() => {}); // Non-critical

  return { canonicalId: normalized, isNew: true };
}
```

**Step 2: Write tests**

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add src/api/lib/concept-pipeline.ts tests/api/concept-pipeline.test.ts
git commit -m "feat: integrate three-tier concept resolution pipeline"
```

---

### Task 7: Information-Theoretic Probe Selection

**Files:**
- Create: `src/core/probe-selection.ts`
- Create: `tests/core/probe-selection.test.ts`

Replace the urgency-based selection with info-gain * relevance.

**Step 1: Write the selection module**

```typescript
// src/core/probe-selection.ts

export interface ProbeCandidate {
  conceptId: string;
  mu: number;
  sigma: number;
  fisherInfo: number;
  urgency: number; // kept for backward compat / logging
}

/**
 * Expected information gain from probing a concept.
 * Approximated as posterior variance reduction via Fisher information.
 *
 * infoGain = sigma^2 - 1/(1/sigma^2 + fisherInfo)
 *
 * Higher when: sigma is large (uncertain) AND Fisher info is high
 * (the probe question is discriminating at this ability level).
 */
export function expectedInfoGain(sigma: number, fisherInfo: number): number {
  const priorVariance = sigma * sigma;
  const posteriorVariance = 1 / (1 / priorVariance + fisherInfo);
  return priorVariance - posteriorVariance;
}

/**
 * Select the best concept to probe using information-theoretic selection
 * weighted by conversational relevance.
 *
 * score(c) = infoGain(c) * relevance(c)
 *
 * relevance(c) = 1 / (1 + embeddingDistance(c, trunk))
 *   where embeddingDistance = 1 - cosineSimilarity
 *
 * When no trunk concept is specified, relevance = 1.0 for all candidates
 * (degrades to pure info-gain selection).
 */
export function selectProbeCandidate(
  candidates: ProbeCandidate[],
  similarities: Map<string, number>, // conceptId -> cosine similarity to trunk
  hasTrunk: boolean,
): { selected: ProbeCandidate; score: number } | null {
  if (candidates.length === 0) return null;

  let best: ProbeCandidate | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    const infoGain = expectedInfoGain(c.sigma, c.fisherInfo);

    let relevance = 1.0;
    if (hasTrunk) {
      const similarity = similarities.get(c.conceptId) ?? 0;
      const distance = 1 - similarity;
      relevance = 1 / (1 + distance);
    }

    const score = infoGain * relevance;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best ? { selected: best, score: bestScore } : null;
}
```

**Step 2: Write tests**

```typescript
// tests/core/probe-selection.test.ts
import { describe, it, expect } from 'vitest';
import { expectedInfoGain, selectProbeCandidate } from '../../src/core/probe-selection.js';

describe('expectedInfoGain', () => {
  it('returns higher gain for uncertain concepts', () => {
    const highSigma = expectedInfoGain(1.5, 1.0);
    const lowSigma = expectedInfoGain(0.3, 1.0);
    expect(highSigma).toBeGreaterThan(lowSigma);
  });

  it('returns 0 when sigma is 0', () => {
    expect(expectedInfoGain(0, 1.0)).toBeCloseTo(0);
  });
});

describe('selectProbeCandidate', () => {
  const candidates = [
    { conceptId: 'a-b-testing', mu: 0, sigma: 1.5, fisherInfo: 1.0, urgency: 0.9 },
    { conceptId: 'thompson-sampling', mu: 0.5, sigma: 1.2, fisherInfo: 0.8, urgency: 0.7 },
  ];

  it('selects by info gain when no trunk', () => {
    const result = selectProbeCandidate(candidates, new Map(), false);
    // Higher sigma = higher info gain → a-b-testing
    expect(result?.selected.conceptId).toBe('a-b-testing');
  });

  it('prefers conversationally relevant concept when trunk is set', () => {
    const similarities = new Map([
      ['a-b-testing', 0.3],       // distant from trunk
      ['thompson-sampling', 0.95], // very close to trunk
    ]);
    const result = selectProbeCandidate(candidates, similarities, true);
    // Thompson-sampling wins due to high relevance despite lower info gain
    expect(result?.selected.conceptId).toBe('thompson-sampling');
  });

  it('returns null for empty candidates', () => {
    expect(selectProbeCandidate([], new Map(), false)).toBeNull();
  });
});
```

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add src/core/probe-selection.ts tests/core/probe-selection.test.ts
git commit -m "feat: information-theoretic probe selection with conversational relevance"
```

---

### Task 8: Wire Pipeline into Observe Endpoint

**Files:**
- Modify: `src/api/routes/mcp.ts` (lines 82-337)
- Modify: `src/api/index.ts` (pass AI binding)

This is the integration task. Replace the current concept insertion loop (lines 90-101) with the resolution pipeline, and replace the urgency sort (line 196) with the new selection function.

**Step 1: Update observe schema to accept `primaryConceptId`**

In `mcp.ts`, update the `observeSchema`:
```typescript
const observeSchema = z.object({
  concepts: z.array(z.object({
    id: z.string().min(1).max(200),
    source: z.enum(['package', 'ast', 'llm']),
  })).min(1).max(50),
  triggerContext: z.string().max(1000).default(''),
  primaryConceptId: z.string().max(200).optional(),
});
```

**Step 2: Replace concept insertion with resolution pipeline**

Replace lines 90-101:
```typescript
// Old: bare insert
// New: resolve through three-tier pipeline
const ai = c.env?.AI ?? null;
const resolvedConcepts = await Promise.all(
  body.concepts.map(async (concept) => {
    const resolved = await resolveConcept(db, concept.id, ai);
    return { ...concept, id: resolved.canonicalId, isNew: resolved.isNew };
  })
);
```

**Step 3: Replace urgency sort with info-theoretic selection**

Replace line 196-197:
```typescript
// Old: const sorted = candidates.sort((a, b) => b.urgency - a.urgency);
//      const selected = sorted[0];

// New: info-theoretic selection with conversational relevance
const trunkId = body.primaryConceptId
  ? (await resolveConceptId(db, body.primaryConceptId))
  : null;

let similarities = new Map<string, number>();
if (trunkId) {
  // Compute embedding similarities between trunk and all candidates
  for (const c of candidates) {
    const sim = await conceptSimilarity(db, c.conceptId, trunkId);
    similarities.set(c.conceptId, sim);
  }
}

const selection = selectProbeCandidate(
  candidates,
  similarities,
  !!trunkId,
);
const selected = selection?.selected ?? null;
```

**Step 4: Update MCP server tool schema**

In `src/mcp/server.ts`, add `primaryConceptId` to the `entendi_observe` tool input schema.

**Step 5: Update API client**

In `src/mcp/api-client.ts`, pass `primaryConceptId` through the observe call.

**Step 6: Run full test suite**

```bash
npm test
```

**Step 7: Commit**

```bash
git add src/api/routes/mcp.ts src/api/index.ts src/mcp/server.ts src/mcp/api-client.ts
git commit -m "feat: wire concept pipeline and info-theoretic selection into observe endpoint"
```

---

### Task 9: Update Concept Detection Skill

**Files:**
- Modify: `plugin/skills/concept-detection/SKILL.md`

**Step 1: Update the skill to pass `primaryConceptId`**

Add to the skill's instructions:

```markdown
## Primary Concept

When calling `entendi_observe`, identify which concept the user is MOST DIRECTLY discussing
and pass it as `primaryConceptId`. This ensures the system probes the right concept.

Rules for primaryConceptId:
- The concept the user explicitly named or is actively working with
- NOT inferred/related concepts — only what they're directly engaging with
- If the user says "let's use Thompson sampling" → primaryConceptId: "thompson-sampling"
- If uncertain which is primary, omit the field (the system falls back to info-gain only)

## Conservative Concept Detection

Only pass concepts the user explicitly mentioned or is directly working with.
Do NOT infer related concepts speculatively. If the user says "Thompson sampling",
pass `thompson-sampling` — do NOT also add `a-b-testing` or `multi-armed-bandits`
unless the user mentioned them.
```

**Step 2: Commit**

```bash
git add plugin/skills/concept-detection/SKILL.md
git commit -m "feat: update concept-detection skill with primaryConceptId and conservative detection"
```

---

### Task 10: Build, Deploy, and Smoke Test

**Step 1: Build**

```bash
npm run build
```

**Step 2: Run full test suite**

```bash
npm test
```

**Step 3: Deploy**

```bash
npx wrangler deploy
```

**Step 4: Add ANTHROPIC_API_KEY to Cloudflare secrets**

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

**Step 5: Smoke test**

1. Open a Claude Code session with Entendi active
2. Say "let's use Thompson sampling for our A/B test"
3. Verify: observe passes `primaryConceptId: "thompson-sampling"`
4. Verify: probe targets `thompson-sampling`, not `a-b-testing`
5. Say "React hooks" — verify concept is normalized and enriched with prerequisites
6. Check Neon DB: `concept_embeddings` should have entries, `concept_edges` should have LLM-inferred prerequisites

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: concept graph — normalization, prerequisites, info-theoretic selection"
```
