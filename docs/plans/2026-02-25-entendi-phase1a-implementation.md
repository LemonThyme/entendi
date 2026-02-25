# Entendi Phase 1a Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade Entendi from Phase 0 prototype to a full probabilistic model with GRM + Laplace approximation, multi-signal concept extraction (AST + LLM), a seed taxonomy of ~130 concepts, and a basic web dashboard.

**Architecture:** Replace the Phase 0 Elo-like Kalman update with Samejima's Graded Response Model using Newton-Raphson MAP estimation and Laplace approximation for the posterior. Add tree-sitter (WASM) for AST-based concept extraction (Signal B) and Claude API structured output for LLM-based extraction (Signal C). Bootstrap the knowledge graph with a curated seed taxonomy. Serve a basic local dashboard via a small HTTP server that reads from `.entendi/` JSON state.

**Tech Stack:** TypeScript 5.x, Node.js 22+, Vitest, esbuild, web-tree-sitter (WASM), @anthropic-ai/sdk (Claude Haiku), Hono (dashboard HTTP server)

**Base branch:** `worktree-luminous-waddling-lantern` at HEAD (`17f3779`)

---

## Dependency Graph

```
Task 1 (Types)
  ├──> Task 2 (GRM + Laplace)    ─┐
  ├──> Task 3 (Seed Taxonomy)     │── can run in parallel
  ├──> Task 4 (AST Extraction)    │
  └──> Task 5 (LLM Extraction)   ─┘
          │
          v
       Task 6 (Phase 0 Fixes + Fisher Probe Selection)  [depends on Task 2]
          │
          v
       Task 7 (Hook Integration)  [depends on Tasks 2-6]
          │
          v
       Task 8 (Dashboard)  [depends on Tasks 1, 3]
          │
          v
       Task 9 (Integration Tests)  [depends on Tasks 2-8]
```

**Parallel waves:**
- Wave 1: Task 1
- Wave 2: Tasks 2, 3, 4, 5 (fully parallel)
- Wave 3: Task 6
- Wave 4: Tasks 7, 8 (parallel)
- Wave 5: Task 9

---

## Context for All Tasks

**Existing codebase:** Phase 0 is complete with 109 tests passing. Key files:
- `src/schemas/types.ts` (160 lines) — all interfaces and factory functions
- `src/core/probabilistic-model.ts` (61 lines) — Elo-like Kalman update + FSRS
- `src/core/knowledge-graph.ts` (83 lines) — in-memory graph + novelty classification
- `src/core/concept-extraction.ts` (170 lines) — package install detection + lookup table
- `src/core/probe-scheduler.ts` (44 lines) — novelty-based probe frequency
- `src/core/probe-engine.ts` (260 lines) — LLM prompt builders + parsers
- `src/core/state-manager.ts` (66 lines) — JSON file persistence
- `src/hooks/post-tool-use.ts` (149 lines) — observer hook
- `src/hooks/user-prompt-submit.ts` (147 lines) — probe response hook
- `src/config/package-concepts.ts` (210 lines) — package-to-concept lookup table
- `src/index.ts` (23 lines) — barrel exports

**Build & test:** `npm run build` (tsc + esbuild), `npm test` (vitest), all tests must pass after every task.

**Design spec:** `docs/plans/2026-02-25-entendi-v0.2-design.md` — Section 5 (probabilistic model), Section 4.5.2 (concept extraction), Section 4.5.3 (taxonomy), Section 13 (technical appendices).

---

### Task 1: Type System Extensions

**Purpose:** Extend the type system to support Phase 1a features — population statistics on concepts, concept taxonomy entries with item parameter estimation, and a factory function for creating ConceptNodes with sensible defaults.

**Files:**
- Modify: `src/schemas/types.ts`
- Test: `tests/core/types.test.ts`

**Step 1: Write failing tests for new types and factory functions**

Add to `tests/core/types.test.ts`:

```typescript
import {
  createInitialMastery,
  createInitialMemory,
  createUserConceptState,
  createEmptyGraphState,
  pMastery,
  DEFAULT_GRM_PARAMS,
  createConceptNode,
  type PopulationStats,
  type ConceptNode,
  type TaxonomySeedEntry,
} from '../../src/schemas/types.js';

// Add these new tests:

it('createConceptNode creates a valid concept with defaults', () => {
  const node = createConceptNode({
    conceptId: 'async-programming',
    domain: 'programming-languages',
    specificity: 'topic',
  });
  expect(node.conceptId).toBe('async-programming');
  expect(node.domain).toBe('programming-languages');
  expect(node.specificity).toBe('topic');
  expect(node.aliases).toEqual([]);
  expect(node.parentConcept).toBeNull();
  expect(node.itemParams).toEqual(DEFAULT_GRM_PARAMS);
  expect(node.relationships).toEqual([]);
  expect(node.lifecycle).toBe('discovered');
  expect(node.populationStats).toEqual({
    meanMastery: 0,
    assessmentCount: 0,
    failureRate: 0,
  });
});

it('createConceptNode accepts overrides', () => {
  const node = createConceptNode({
    conceptId: 'react-hooks',
    domain: 'frontend',
    specificity: 'technique',
    aliases: ['React Hooks', 'Hooks'],
    parentConcept: 'react',
    lifecycle: 'stable',
  });
  expect(node.aliases).toEqual(['React Hooks', 'Hooks']);
  expect(node.parentConcept).toBe('react');
  expect(node.lifecycle).toBe('stable');
});

it('PopulationStats type has correct shape', () => {
  const stats: PopulationStats = {
    meanMastery: 0.75,
    assessmentCount: 42,
    failureRate: 0.15,
  };
  expect(stats.meanMastery).toBe(0.75);
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/core/types.test.ts
```

Expected: FAIL — `createConceptNode` and `PopulationStats` not exported.

**Step 3: Implement type extensions**

Add to `src/schemas/types.ts`:

```typescript
// --- Population Statistics (per concept, across all users) ---
export interface PopulationStats {
  meanMastery: number;
  assessmentCount: number;
  failureRate: number;
}

export function createDefaultPopulationStats(): PopulationStats {
  return { meanMastery: 0, assessmentCount: 0, failureRate: 0 };
}
```

Add `populationStats: PopulationStats` field to the `ConceptNode` interface. Then add a factory function:

```typescript
/** Create a ConceptNode with sensible defaults. Only conceptId, domain, specificity required. */
export function createConceptNode(seed: {
  conceptId: string;
  domain: string;
  specificity: ConceptSpecificity;
  aliases?: string[];
  parentConcept?: string | null;
  itemParams?: GRMItemParams;
  relationships?: ConceptEdge[];
  lifecycle?: ConceptLifecycle;
  populationStats?: PopulationStats;
}): ConceptNode {
  return {
    conceptId: seed.conceptId,
    aliases: seed.aliases ?? [],
    domain: seed.domain,
    specificity: seed.specificity,
    parentConcept: seed.parentConcept ?? null,
    itemParams: seed.itemParams ?? DEFAULT_GRM_PARAMS,
    relationships: seed.relationships ?? [],
    lifecycle: seed.lifecycle ?? 'discovered',
    populationStats: seed.populationStats ?? createDefaultPopulationStats(),
  };
}
```

Also add a `TaxonomySeedEntry` type for use by the seed taxonomy module:

```typescript
/** Lightweight entry for defining seed concepts in the taxonomy. */
export interface TaxonomySeedEntry {
  conceptId: string;
  aliases: string[];
  domain: string;
  specificity: ConceptSpecificity;
  parentConcept: string | null;
  relationships: ConceptEdge[];
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/core/types.test.ts
```

Expected: All tests PASS including the 3 existing ones.

**Step 5: Update barrel exports**

Since `src/index.ts` already has `export * from './schemas/types.js'`, the new types are automatically exported. No change needed.

**Step 6: Run full test suite**

```bash
npm test
```

Expected: All 109+ tests PASS.

**Step 7: Commit**

```bash
git add src/schemas/types.ts tests/core/types.test.ts
git commit -m "feat: extend type system with PopulationStats, createConceptNode, and TaxonomySeedEntry"
```

---

### Task 2: GRM + Laplace Bayesian Update

**Purpose:** Replace the Phase 0 Elo-like Kalman update (`bayesianUpdate`) with Samejima's full Graded Response Model using Newton-Raphson MAP estimation and Laplace approximation for the posterior. Also add GRM Fisher information for probe selection.

**Depends on:** Task 1

**Files:**
- Modify: `src/core/probabilistic-model.ts`
- Modify: `tests/core/probabilistic-model.test.ts`
- Modify: `src/index.ts`

**Background (from spec Section 5.1-5.4):**

The GRM defines cumulative probabilities `P*(k | theta) = logistic(a * (theta - b_k))` where `a` is discrimination and `b_k` are thresholds. The category probability of score k is `P_k = P*_k - P*_{k+1}`. The posterior is found via Laplace approximation: Newton-Raphson finds the MAP estimate, then the Hessian curvature gives the posterior variance.

Key math:
- BRF: `P*_k(theta) = logistic(a * (theta - b_k))`
- BRF 1st deriv: `dP*_k/dtheta = a * P*_k * (1 - P*_k)`
- BRF 2nd deriv: `d^2P*_k/dtheta^2 = a^2 * P*_k * (1-P*_k) * (1-2*P*_k)`
- Log-likelihood gradient: `(Q_s - Q_{s+1}) / P_s` where `Q_k = dP*_k/dtheta`
- Log-likelihood hessian: `(R_s - R_{s+1})/P_s - [(Q_s-Q_{s+1})/P_s]^2` where `R_k = d^2P*_k/dtheta^2`
- Prior gradient: `-(theta - mu_eff) / sigma_eff^2`
- Prior hessian: `-1 / sigma_eff^2`
- Newton-Raphson: `theta_{n+1} = theta_n - gradient/hessian`
- Laplace sigma: `sigma_post = sqrt(-1/hessian_at_MAP)`
- Fisher info: `I(theta) = sum_{k=0..3} (dP_k/dtheta)^2 / P_k`

**Step 1: Write failing tests for GRM functions**

Add to `tests/core/probabilistic-model.test.ts`:

```typescript
import {
  retrievability,
  decayPrior,
  bayesianUpdate,
  grmBayesianUpdate,
  grmUpdate,
  grmFisherInformation,
  grmCategoryProbs,
  fsrsStabilityAfterSuccess,
  fsrsDifficultyUpdate,
  mapRubricToFsrsGrade,
} from '../../src/core/probabilistic-model.js';
import { DEFAULT_GRM_PARAMS } from '../../src/schemas/types.js';

describe('GRM Bayesian Update', () => {
  it('returns converged result with default params and score=2', () => {
    const result = grmBayesianUpdate(2, 0.0, 1.5);
    expect(result.converged).toBe(true);
    expect(result.mu).toBeGreaterThan(0.0); // Score 2 above middle threshold
    expect(result.sigma).toBeLessThan(1.5); // Gained information
    expect(result.sigma).toBeGreaterThan(0.05);
  });

  it('shifts mu upward for high score (3)', () => {
    const result = grmBayesianUpdate(3, 0.0, 1.5);
    expect(result.mu).toBeGreaterThan(0.5);
  });

  it('shifts mu downward for low score (0)', () => {
    const result = grmBayesianUpdate(0, 0.0, 1.5);
    expect(result.mu).toBeLessThan(-0.3);
  });

  it('shifts mu less when prior sigma is small (high confidence)', () => {
    const highConf = grmBayesianUpdate(3, 0.0, 0.3);
    const lowConf = grmBayesianUpdate(3, 0.0, 1.5);
    expect(Math.abs(highConf.mu)).toBeLessThan(Math.abs(lowConf.mu));
  });

  it('uses custom GRM item parameters', () => {
    const easyItem = { discrimination: 0.5, thresholds: [-2.0, -1.0, 0.0] as [number, number, number] };
    const hardItem = { discrimination: 2.0, thresholds: [0.0, 1.0, 2.0] as [number, number, number] };
    const easy = grmBayesianUpdate(2, 0.0, 1.5, easyItem);
    const hard = grmBayesianUpdate(2, 0.0, 1.5, hardItem);
    expect(hard.sigma).toBeLessThan(easy.sigma);
  });

  it('converges within 25 iterations for extreme prior', () => {
    const result = grmBayesianUpdate(3, -5.0, 1.5);
    expect(result.converged).toBe(true);
    expect(result.mu).toBeGreaterThan(-5.0);
  });
});

describe('grmUpdate (MasteryState wrapper)', () => {
  it('returns MasteryState-compatible result', () => {
    const updated = grmUpdate({ mu: 0.0, sigma: 1.5 }, 2);
    expect(updated).toHaveProperty('mu');
    expect(updated).toHaveProperty('sigma');
    expect(typeof updated.mu).toBe('number');
    expect(typeof updated.sigma).toBe('number');
  });
});

describe('GRM Category Probabilities', () => {
  it('category probs sum to ~1.0', () => {
    const probs = grmCategoryProbs(0.0, DEFAULT_GRM_PARAMS);
    const sum = probs[0] + probs[1] + probs[2] + probs[3];
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('higher theta increases P(score=3)', () => {
    const lowTheta = grmCategoryProbs(-2.0, DEFAULT_GRM_PARAMS);
    const highTheta = grmCategoryProbs(2.0, DEFAULT_GRM_PARAMS);
    expect(highTheta[3]).toBeGreaterThan(lowTheta[3]);
  });

  it('returns 4 non-negative probabilities', () => {
    const probs = grmCategoryProbs(1.0, DEFAULT_GRM_PARAMS);
    expect(probs).toHaveLength(4);
    for (const p of probs) {
      expect(p).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('GRM Fisher Information', () => {
  it('is positive for any theta', () => {
    expect(grmFisherInformation(0.0)).toBeGreaterThan(0);
    expect(grmFisherInformation(-3.0)).toBeGreaterThan(0);
    expect(grmFisherInformation(3.0)).toBeGreaterThan(0);
  });

  it('peaks near the middle threshold', () => {
    const atMiddle = grmFisherInformation(0.0);
    const farAway = grmFisherInformation(5.0);
    expect(atMiddle).toBeGreaterThan(farAway);
  });

  it('scales with discrimination parameter', () => {
    const lowDisc = grmFisherInformation(0.0, { discrimination: 0.5, thresholds: [-1, 0, 1] });
    const highDisc = grmFisherInformation(0.0, { discrimination: 2.0, thresholds: [-1, 0, 1] });
    expect(highDisc).toBeGreaterThan(lowDisc);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/core/probabilistic-model.test.ts
```

Expected: FAIL — `grmBayesianUpdate`, `grmUpdate`, `grmCategoryProbs`, `grmFisherInformation` not exported.

**Step 3: Implement GRM functions**

Add to `src/core/probabilistic-model.ts` (keep all existing functions — `bayesianUpdate` remains for backward compatibility):

```typescript
import { type MasteryState, type RubricScore, type GRMItemParams, DEFAULT_GRM_PARAMS, pMastery } from '../schemas/types.js';

// ... existing code (retrievability, decayPrior, bayesianUpdate, FSRS functions) stays unchanged ...

// ─── GRM Constants ──────────────────────────────────────────────────────────

const EPSILON = 1e-15;
const NR_MAX_ITER = 25;
const NR_TOLERANCE = 1e-6;
const NR_MAX_STEP = 3.0;
const SIGMA_MIN = 0.05;
const SIGMA_MAX = 1.5;

// ─── GRM Boundary Response Function ─────────────────────────────────────────

/** Numerically stable logistic: P*(k | theta) = logistic(a * (theta - b_k)) */
function brf(theta: number, a: number, b: number): number {
  const z = a * (theta - b);
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const expZ = Math.exp(z);
  return expZ / (1 + expZ);
}

/** Cumulative probabilities P*_k for k=0..4. P*_0=1, P*_4=0. */
function cumulativeProbs(
  theta: number, a: number, thresholds: [number, number, number],
): [number, number, number, number, number] {
  return [1.0, brf(theta, a, thresholds[0]), brf(theta, a, thresholds[1]), brf(theta, a, thresholds[2]), 0.0];
}

/** Category probabilities P_k = P*_k - P*_{k+1} for k=0..3. Clamped to EPSILON. */
export function grmCategoryProbs(
  theta: number, itemParams: GRMItemParams = DEFAULT_GRM_PARAMS,
): [number, number, number, number] {
  const { discrimination: a, thresholds } = itemParams;
  const ps = cumulativeProbs(theta, a, thresholds);
  return [
    Math.max(EPSILON, ps[0] - ps[1]),
    Math.max(EPSILON, ps[1] - ps[2]),
    Math.max(EPSILON, ps[2] - ps[3]),
    Math.max(EPSILON, ps[3] - ps[4]),
  ];
}

// ─── Derivatives ─────────────────────────────────────────────────────────────

function brfDeriv1(pStar: number, a: number): number {
  return a * pStar * (1 - pStar);
}

function brfDeriv2(pStar: number, a: number): number {
  return a * a * pStar * (1 - pStar) * (1 - 2 * pStar);
}

interface PosteriorDerivs {
  logPost: number;
  gradient: number;
  hessian: number;
}

function posteriorDerivatives(
  theta: number, score: number, a: number,
  thresholds: [number, number, number], priorMu: number, priorSigma: number,
): PosteriorDerivs {
  const ps = cumulativeProbs(theta, a, thresholds);
  const pS = Math.max(EPSILON, ps[score] - ps[score + 1]);

  const qS = score === 0 ? 0 : brfDeriv1(ps[score], a);
  const qS1 = score === 3 ? 0 : brfDeriv1(ps[score + 1], a);
  const rS = score === 0 ? 0 : brfDeriv2(ps[score], a);
  const rS1 = score === 3 ? 0 : brfDeriv2(ps[score + 1], a);

  const logLik = Math.log(pS);
  const dLogLik = (qS - qS1) / pS;
  const d2LogLik = (rS - rS1) / pS - ((qS - qS1) / pS) ** 2;

  const sigSq = priorSigma * priorSigma;
  const diff = theta - priorMu;

  return {
    logPost: logLik + (-0.5 * diff * diff / sigSq),
    gradient: dLogLik + (-diff / sigSq),
    hessian: d2LogLik + (-1 / sigSq),
  };
}

// ─── Newton-Raphson MAP Estimation + Laplace ─────────────────────────────────

export interface GRMUpdateResult {
  mu: number;
  sigma: number;
  converged: boolean;
  iterations: number;
}

/**
 * Full GRM Bayesian update using Laplace approximation.
 * Finds theta_MAP via Newton-Raphson, then computes posterior sigma
 * from the Hessian curvature at the MAP.
 */
export function grmBayesianUpdate(
  score: RubricScore, priorMu: number, priorSigma: number,
  itemParams: GRMItemParams = DEFAULT_GRM_PARAMS,
): GRMUpdateResult {
  const { discrimination: a, thresholds } = itemParams;
  let theta = priorMu;
  let converged = false;
  let iter = 0;

  for (iter = 0; iter < NR_MAX_ITER; iter++) {
    const { gradient, hessian } = posteriorDerivatives(theta, score, a, thresholds, priorMu, priorSigma);

    if (hessian >= 0) {
      theta += 0.1 * gradient; // Fallback: gradient step with dampening
    } else {
      let step = -gradient / hessian;
      if (Math.abs(step) > NR_MAX_STEP) step = NR_MAX_STEP * Math.sign(step);
      theta += step;
    }

    const { gradient: newGrad } = posteriorDerivatives(theta, score, a, thresholds, priorMu, priorSigma);
    if (Math.abs(newGrad) < NR_TOLERANCE) {
      converged = true;
      iter++;
      break;
    }
  }

  const { hessian } = posteriorDerivatives(theta, score, a, thresholds, priorMu, priorSigma);
  let sigmaPost = hessian < 0 ? Math.sqrt(-1 / hessian) : priorSigma;
  sigmaPost = Math.max(SIGMA_MIN, Math.min(SIGMA_MAX, sigmaPost));

  return { mu: theta, sigma: sigmaPost, converged, iterations: iter };
}

/** Drop-in replacement for bayesianUpdate using full GRM + Laplace. */
export function grmUpdate(
  mastery: MasteryState, score: RubricScore, itemParams?: GRMItemParams,
): MasteryState {
  const result = grmBayesianUpdate(score, mastery.mu, mastery.sigma, itemParams);
  return { mu: result.mu, sigma: result.sigma };
}

// ─── Fisher Information ─────────────────────────────────────────────────────

/**
 * Expected Fisher information I(theta) for a GRM item.
 * I(theta) = sum_{k=0}^{K-1} [ (dP_k/dtheta)^2 / P_k ]
 */
export function grmFisherInformation(
  theta: number, itemParams: GRMItemParams = DEFAULT_GRM_PARAMS,
): number {
  const { discrimination: a, thresholds } = itemParams;
  const ps = cumulativeProbs(theta, a, thresholds);
  let info = 0;

  for (let k = 0; k <= 3; k++) {
    const pk = Math.max(EPSILON, ps[k] - ps[k + 1]);
    const qk = k === 0 ? 0 : brfDeriv1(ps[k], a);
    const qk1 = k === 3 ? 0 : brfDeriv1(ps[k + 1], a);
    const dpk = qk - qk1;
    info += (dpk * dpk) / pk;
  }

  return info;
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/core/probabilistic-model.test.ts
```

Expected: All existing (20) + new GRM tests PASS.

**Step 5: Update barrel exports**

Replace the existing probabilistic-model exports in `src/index.ts`:

```typescript
export {
  retrievability,
  decayPrior,
  bayesianUpdate,
  grmBayesianUpdate,
  grmUpdate,
  grmCategoryProbs,
  grmFisherInformation,
  fsrsStabilityAfterSuccess,
  fsrsDifficultyUpdate,
  mapRubricToFsrsGrade,
} from './core/probabilistic-model.js';
```

**Step 6: Run full test suite**

```bash
npm test
```

Expected: All tests PASS.

**Step 7: Commit**

```bash
git add src/core/probabilistic-model.ts tests/core/probabilistic-model.test.ts src/index.ts
git commit -m "feat: add full GRM + Laplace Bayesian update and Fisher information"
```

---

### Task 3: Seed Concept Taxonomy

**Purpose:** Create a curated taxonomy of ~130 seed concepts covering programming, web development, databases, DevOps, security, AI/ML, and more. These form the stable backbone of the knowledge graph that makes mastery comparable across users.

**Depends on:** Task 1

**Files:**
- Create: `src/config/seed-taxonomy.ts`
- Create: `tests/config/seed-taxonomy.test.ts`
- Modify: `src/index.ts`

**Step 1: Write failing tests**

Create `tests/config/seed-taxonomy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SEED_CONCEPTS, buildSeedConceptNodes, seedTaxonomyStats } from '../../src/config/seed-taxonomy.js';
import type { ConceptNode } from '../../src/schemas/types.js';

describe('Seed Taxonomy', () => {
  it('exports a non-empty array of seed concepts', () => {
    expect(SEED_CONCEPTS.length).toBeGreaterThan(50);
  });

  it('every seed has required fields', () => {
    for (const seed of SEED_CONCEPTS) {
      expect(seed.conceptId).toBeTruthy();
      expect(seed.domain).toBeTruthy();
      expect(['domain', 'topic', 'technique']).toContain(seed.specificity);
      expect(Array.isArray(seed.aliases)).toBe(true);
      expect(Array.isArray(seed.relationships)).toBe(true);
    }
  });

  it('has no duplicate concept IDs', () => {
    const ids = SEED_CONCEPTS.map(s => s.conceptId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all relationship targets reference existing concepts', () => {
    const ids = new Set(SEED_CONCEPTS.map(s => s.conceptId));
    for (const seed of SEED_CONCEPTS) {
      for (const rel of seed.relationships) {
        expect(ids.has(rel.target)).toBe(true);
      }
      if (seed.parentConcept) {
        expect(ids.has(seed.parentConcept)).toBe(true);
      }
    }
  });

  it('has no cycles in parent chain', () => {
    const parentMap = new Map(SEED_CONCEPTS.map(s => [s.conceptId, s.parentConcept]));
    for (const seed of SEED_CONCEPTS) {
      const visited = new Set<string>();
      let current: string | null = seed.conceptId;
      while (current) {
        expect(visited.has(current)).toBe(false);
        visited.add(current);
        current = parentMap.get(current) ?? null;
      }
    }
  });
});

describe('buildSeedConceptNodes', () => {
  it('returns a Record<string, ConceptNode> with all seeds', () => {
    const nodes = buildSeedConceptNodes();
    expect(Object.keys(nodes).length).toBe(SEED_CONCEPTS.length);
    for (const seed of SEED_CONCEPTS) {
      expect(nodes[seed.conceptId]).toBeDefined();
      const node = nodes[seed.conceptId];
      expect(node.lifecycle).toBe('stable');
      expect(node.conceptId).toBe(seed.conceptId);
    }
  });
});

describe('seedTaxonomyStats', () => {
  it('returns correct counts', () => {
    const stats = seedTaxonomyStats();
    expect(stats.total).toBe(SEED_CONCEPTS.length);
    expect(stats.domains).toBeGreaterThan(0);
    expect(stats.topics).toBeGreaterThan(0);
    expect(stats.techniques).toBeGreaterThan(0);
    expect(stats.domains + stats.topics + stats.techniques).toBe(stats.total);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/config/seed-taxonomy.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement seed taxonomy**

Create `src/config/seed-taxonomy.ts`. The file should export:

1. `SEED_CONCEPTS: TaxonomySeedEntry[]` — the raw array of ~130 seed concept definitions
2. `buildSeedConceptNodes(): Record<string, ConceptNode>` — converts seeds into ConceptNode objects with `lifecycle: 'stable'`
3. `seedTaxonomyStats(): { total, domains, topics, techniques }` — summary counts

The seed concepts should cover these 10 domains with a mix of topics and techniques:

| Domain | Example Concepts |
|--------|-----------------|
| `programming-languages` | Variables & Data Types, Control Flow, Functions, Type Systems, OOP, Functional Programming, Async Programming, Error Handling, Closures, Iterators & Generators, Generics, Decorators & Metaprogramming, Memory Management, Modules & Imports, Regular Expressions, Pattern Matching, Concurrency Primitives, Event Loop |
| `data-structures-algorithms` | Arrays & Lists, Hash Maps, Trees, Graphs, Stacks & Queues, Sorting, Searching, Recursion, Dynamic Programming, Graph Algorithms, Big-O Complexity |
| `web-development` | HTTP Protocol, REST API Design, GraphQL, WebSockets, Authentication (JWT, OAuth), Session Management, CORS, Middleware, Routing, Server-Side Rendering, Web Security, API Rate Limiting, Request/Response Lifecycle, URL Routing, Content Negotiation |
| `frontend` | DOM Manipulation, React, Component Architecture, State Management, CSS Layout (Flexbox/Grid), Responsive Design, Virtual DOM, React Hooks, Client-Side Routing, Browser APIs, Accessibility, Build Tools (Webpack/Vite) |
| `databases` | SQL Fundamentals, Database Design, Indexing, Transactions & ACID, ORM, NoSQL, Query Optimization, Data Modeling, Migrations, Connection Pooling, Replication, Caching Strategies |
| `system-design` | Distributed Systems, Microservices, Message Queues, Load Balancing, Caching, API Gateway, Event-Driven Architecture, CAP Theorem, Consistent Hashing, Circuit Breaker Pattern, Service Discovery, Rate Limiting, Idempotency, CQRS, Eventual Consistency |
| `devops` | Docker, Container Orchestration, CI/CD, Infrastructure as Code, Monitoring & Observability, Logging, Linux Administration, Networking Fundamentals, DNS, TLS/SSL, Environment Management, Secrets Management, Cloud Services |
| `testing` | Unit Testing, Integration Testing, Test-Driven Development, Mocking & Stubbing, End-to-End Testing, Property-Based Testing, Test Coverage, Regression Testing, Snapshot Testing, Performance Testing |
| `security` | Input Validation, SQL Injection Prevention, XSS Prevention, CSRF Protection, Encryption, Hashing & Salting, Secure Authentication, Authorization & RBAC, OWASP Top 10, Dependency Vulnerability Scanning, Secrets Management |
| `ai-ml` | LLM Fundamentals, Prompt Engineering, RAG Pattern, Embeddings & Vectors, Fine-Tuning, AI Agent Patterns, Token Management, Model Evaluation, Supervised Learning, Neural Networks, NLP Basics, AI Ethics |

Use the `TaxonomySeedEntry` type from Task 1. Each concept needs:
- `conceptId`: kebab-case unique identifier
- `aliases`: human-readable names and common variations
- `domain`: one of the 10 domains above
- `specificity`: `'domain'` (broadest) | `'topic'` (primary level) | `'technique'` (specific)
- `parentConcept`: parent concept ID or `null`
- `relationships`: array of `ConceptEdge` with `requires` and `part_of` edges

The `buildSeedConceptNodes()` function should use `createConceptNode()` from Task 1 with `lifecycle: 'stable'`.

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/config/seed-taxonomy.test.ts
```

Expected: All tests PASS.

**Step 5: Update barrel exports**

Add to `src/index.ts`:

```typescript
export { SEED_CONCEPTS, buildSeedConceptNodes, seedTaxonomyStats } from './config/seed-taxonomy.js';
```

**Step 6: Run full test suite**

```bash
npm test
```

Expected: All tests PASS.

**Step 7: Commit**

```bash
git add src/config/seed-taxonomy.ts tests/config/seed-taxonomy.test.ts src/index.ts
git commit -m "feat: add seed concept taxonomy with ~130 curated concepts"
```

---

### Task 4: Tree-sitter AST Extraction (Signal B)

**Purpose:** Add AST-based concept extraction from source code using tree-sitter (WASM). Detects language features (async/await, generics, decorators), design patterns, and API usage patterns from TypeScript, JavaScript, and Python code.

**Depends on:** Task 1

**Files:**
- Create: `src/core/ast-extraction.ts`
- Create: `tests/core/ast-extraction.test.ts`
- Modify: `package.json` (add web-tree-sitter dependency)
- Modify: `src/index.ts`

**Step 1: Install web-tree-sitter and grammar packages**

```bash
npm install web-tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-python
```

Check that `.wasm` files are available:
```bash
find node_modules/tree-sitter-typescript -name "*.wasm" 2>/dev/null
find node_modules/tree-sitter-javascript -name "*.wasm" 2>/dev/null
find node_modules/tree-sitter-python -name "*.wasm" 2>/dev/null
```

If `.wasm` files aren't found, use `tree-sitter-wasms` package as a fallback source or generate them with `tree-sitter-cli`. The implementation should handle missing `.wasm` files gracefully.

**Step 2: Write failing tests**

Create `tests/core/ast-extraction.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { extractConceptsFromSource, initParser, type ASTExtractedConcept } from '../../src/core/ast-extraction.js';

describe('AST Concept Extraction', () => {
  beforeAll(async () => {
    await initParser();
  });

  describe('TypeScript language features', () => {
    it('detects async/await', async () => {
      const source = `
        async function fetchData(url: string) {
          const response = await fetch(url);
          return response.json();
        }
      `;
      const concepts = await extractConceptsFromSource(source, 'typescript');
      const names = concepts.map(c => c.name);
      expect(names).toContain('async-programming');
    });

    it('detects generics', async () => {
      const source = `
        function identity<T>(arg: T): T {
          return arg;
        }
      `;
      const concepts = await extractConceptsFromSource(source, 'typescript');
      const names = concepts.map(c => c.name);
      expect(names).toContain('generics');
    });

    it('detects try/catch error handling', async () => {
      const source = `
        try {
          riskyOperation();
        } catch (error) {
          console.error(error);
        }
      `;
      const concepts = await extractConceptsFromSource(source, 'typescript');
      const names = concepts.map(c => c.name);
      expect(names).toContain('error-handling');
    });

    it('detects class declarations with OOP patterns', async () => {
      const source = `
        class Animal {
          constructor(public name: string) {}
          speak(): string { return this.name; }
        }
        class Dog extends Animal {
          speak(): string { return 'Woof!'; }
        }
      `;
      const concepts = await extractConceptsFromSource(source, 'typescript');
      const names = concepts.map(c => c.name);
      expect(names).toContain('oop');
    });

    it('detects destructuring', async () => {
      const source = `
        const { name, age } = person;
        const [first, ...rest] = items;
      `;
      const concepts = await extractConceptsFromSource(source, 'typescript');
      const names = concepts.map(c => c.name);
      expect(names).toContain('destructuring');
    });

    it('detects generators/iterators', async () => {
      const source = `
        function* range(start: number, end: number) {
          for (let i = start; i < end; i++) {
            yield i;
          }
        }
      `;
      const concepts = await extractConceptsFromSource(source, 'typescript');
      const names = concepts.map(c => c.name);
      expect(names).toContain('iterators-generators');
    });
  });

  describe('return type', () => {
    it('returns ExtractedConcept-compatible objects', async () => {
      const source = `async function f() { await Promise.resolve(); }`;
      const concepts = await extractConceptsFromSource(source, 'typescript');
      expect(concepts.length).toBeGreaterThan(0);
      for (const c of concepts) {
        expect(c.extractionSignal).toBe('ast');
        expect(c.confidence).toBeGreaterThan(0);
        expect(c.confidence).toBeLessThanOrEqual(1);
        expect(c.name).toBeTruthy();
        expect(['domain', 'topic', 'technique']).toContain(c.specificity);
      }
    });
  });

  describe('edge cases', () => {
    it('returns empty array for simple code with no detectable features', async () => {
      const source = `const x = 1 + 2;`;
      const concepts = await extractConceptsFromSource(source, 'typescript');
      expect(Array.isArray(concepts)).toBe(true);
    });

    it('returns empty array for empty source', async () => {
      const concepts = await extractConceptsFromSource('', 'typescript');
      expect(concepts).toEqual([]);
    });
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npm test -- tests/core/ast-extraction.test.ts
```

Expected: FAIL — module not found.

**Step 4: Implement AST extraction**

Create `src/core/ast-extraction.ts`:

The module should:
1. Export `initParser()` — async, calls `Parser.init()` from `web-tree-sitter`, caches the promise
2. Export `extractConceptsFromSource(source, language)` — parses source, runs pattern detectors, returns `ASTExtractedConcept[]`
3. Export `type ASTExtractedConcept extends ExtractedConcept`

Supported languages: `'typescript' | 'javascript' | 'python'`

Use `import { Parser } from 'web-tree-sitter'` (clean ESM import). Load `.wasm` files using `import.meta.url` to resolve paths relative to the source file. Cache language objects so they're only loaded once.

Pattern detectors (use `root.descendantsOfType()` for simplicity):
- **async/await**: `'await_expression'` nodes → concept `'async-programming'`, specificity `'topic'`, confidence `0.9`
- **generics**: `'type_parameters'` nodes → concept `'generics'`, specificity `'technique'`, confidence `0.9`
- **generators**: `'generator_function_declaration'` or `'yield_expression'` → concept `'iterators-generators'`, specificity `'technique'`, confidence `0.9`
- **try/catch**: `'try_statement'` → concept `'error-handling'`, specificity `'topic'`, confidence `0.8`
- **classes + inheritance**: `'class_declaration'` → concept `'oop'`, specificity `'topic'`, confidence `0.85`
- **destructuring**: `'object_pattern'` or `'array_pattern'` → concept `'destructuring'`, specificity `'technique'`, confidence `0.85`
- **decorators**: `'decorator'` → concept `'decorators-metaprogramming'`, specificity `'technique'`, confidence `0.9`
- **imports**: `'import_statement'` (>3) → concept `'modules-imports'`, specificity `'technique'`, confidence `0.7`

Deduplicate concepts by name before returning.

If `.wasm` files can't be loaded (e.g., missing from npm packages), `initParser()` should log a warning to stderr and `extractConceptsFromSource` should return `[]`.

**Step 5: Run tests to verify they pass**

```bash
npm test -- tests/core/ast-extraction.test.ts
```

Expected: All tests PASS.

**Step 6: Update barrel exports**

Add to `src/index.ts`:

```typescript
export { extractConceptsFromSource, initParser } from './core/ast-extraction.js';
```

**Step 7: Run full test suite**

```bash
npm test
```

Expected: All tests PASS.

**Step 8: Commit**

```bash
git add src/core/ast-extraction.ts tests/core/ast-extraction.test.ts src/index.ts package.json package-lock.json
git commit -m "feat: add tree-sitter AST-based concept extraction (Signal B)"
```

---

### Task 5: LLM Structured Output Extraction (Signal C)

**Purpose:** Add LLM-based concept extraction from prompts and responses using Claude Haiku with structured JSON output. Implements the spec's two-pass extraction pipeline (though for Phase 1a, the single-pass entity recognition suffices).

**Depends on:** Task 1

**Files:**
- Create: `src/core/llm-extraction.ts`
- Create: `tests/core/llm-extraction.test.ts`
- Modify: `src/index.ts`

**Step 1: Write failing tests**

Create `tests/core/llm-extraction.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildConceptExtractionPrompt,
  parseConceptExtractionResponse,
  type LLMExtractedConcepts,
} from '../../src/core/llm-extraction.js';

describe('LLM Concept Extraction', () => {
  describe('buildConceptExtractionPrompt', () => {
    it('builds a prompt with the interaction text', () => {
      const prompt = buildConceptExtractionPrompt('How do I implement a Redis cache with TTL?');
      expect(prompt).toContain('How do I implement a Redis cache with TTL?');
      expect(prompt).toContain('concepts');
      expect(prompt).toContain('JSON');
    });

    it('includes context when provided', () => {
      const prompt = buildConceptExtractionPrompt(
        'Add caching layer',
        { fileContext: 'src/api/handler.ts', projectContext: 'express-app' },
      );
      expect(prompt).toContain('src/api/handler.ts');
      expect(prompt).toContain('express-app');
    });
  });

  describe('parseConceptExtractionResponse', () => {
    it('parses valid JSON response', () => {
      const raw = JSON.stringify({
        concepts: [
          { name: 'Redis', specificity: 'technique', domain: 'databases', signals: ['mentioned Redis cache'] },
          { name: 'Caching', specificity: 'topic', domain: 'system-design', signals: ['TTL caching pattern'] },
        ],
        primaryIntent: 'building',
        apparentFamiliarity: 'intermediate',
      });
      const result = parseConceptExtractionResponse(raw);
      expect(result.concepts).toHaveLength(2);
      expect(result.concepts[0].name).toBe('Redis');
      expect(result.primaryIntent).toBe('building');
    });

    it('parses JSON from markdown code block', () => {
      const raw = '```json\n{"concepts": [{"name": "React", "specificity": "topic", "domain": "frontend", "signals": ["using React"]}], "primaryIntent": "building", "apparentFamiliarity": "intermediate"}\n```';
      const result = parseConceptExtractionResponse(raw);
      expect(result.concepts).toHaveLength(1);
      expect(result.concepts[0].name).toBe('React');
    });

    it('returns empty concepts for unparseable response', () => {
      const result = parseConceptExtractionResponse('This is not JSON at all');
      expect(result.concepts).toEqual([]);
      expect(result.primaryIntent).toBe('unknown');
    });

    it('converts extracted concepts to ExtractedConcept format', () => {
      const raw = JSON.stringify({
        concepts: [
          { name: 'Docker', specificity: 'topic', domain: 'devops', signals: ['containerization'] },
        ],
        primaryIntent: 'building',
        apparentFamiliarity: 'novice',
      });
      const result = parseConceptExtractionResponse(raw);
      expect(result.concepts[0]).toMatchObject({
        name: 'Docker',
        specificity: 'topic',
        extractionSignal: 'llm',
        confidence: expect.any(Number),
      });
    });
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- tests/core/llm-extraction.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement LLM extraction**

Create `src/core/llm-extraction.ts`:

The module should export:
- `buildConceptExtractionPrompt(text, context?)` — builds the prompt instructing the LLM to extract concepts as JSON
- `parseConceptExtractionResponse(raw)` — parses LLM response, handles markdown code blocks, fallback to empty
- `extractConceptsViaLLM(text, context?)` — async, calls Claude Haiku via lazy Anthropic client (same pattern as `probe-engine.ts`)
- `LLMExtractedConcept` type extending `ExtractedConcept` with `domain: string` and `signals: string[]`
- `LLMExtractedConcepts` type: `{ concepts: LLMExtractedConcept[], primaryIntent: string, apparentFamiliarity: string }`

The prompt should instruct the LLM to:
- Return valid JSON matching the schema from spec Section 4.5.2
- Use kebab-case canonical concept names
- Include 1-5 concepts maximum
- Include specificity (domain/topic/technique) and domain
- Include signals (what in the text indicated this concept)
- Include primaryIntent (learning/building/debugging/designing)
- Include apparentFamiliarity (novice/intermediate/advanced)

The parser should:
- Try raw JSON first, then markdown code block extraction
- Validate that parsed result has `concepts` array
- Filter concepts with missing required fields
- Default confidence to 0.7 (LLM extraction is moderate confidence)
- Set `extractionSignal: 'llm'` on all returned concepts
- Return empty result on any parse failure

**Step 4: Run tests to verify they pass**

```bash
npm test -- tests/core/llm-extraction.test.ts
```

Expected: All tests PASS. (Tests only test pure functions, not the LLM call.)

**Step 5: Update barrel exports**

Add to `src/index.ts`:

```typescript
export {
  buildConceptExtractionPrompt,
  parseConceptExtractionResponse,
  extractConceptsViaLLM,
} from './core/llm-extraction.js';
```

**Step 6: Run full test suite**

```bash
npm test
```

Expected: All tests PASS.

**Step 7: Commit**

```bash
git add src/core/llm-extraction.ts tests/core/llm-extraction.test.ts src/index.ts
git commit -m "feat: add LLM-based concept extraction with structured output (Signal C)"
```

---

### Task 6: Phase 0 Fixes + Fisher Information Probe Selection

**Purpose:** Fix known Phase 0 issues: replace sigma proxy with real FSRS stability in probe selection, use GRM Fisher information, add critical novelty assignment for security concepts, cap assessment history, add PostToolUse options parity, and make PostToolUse use `selectConceptToProbe` instead of probing only the first concept.

**Depends on:** Task 2 (GRM Fisher information)

**Files:**
- Modify: `src/core/probe-scheduler.ts`
- Modify: `src/core/knowledge-graph.ts`
- Modify: `src/hooks/post-tool-use.ts`
- Modify: `tests/core/probe-scheduler.test.ts`
- Modify: `tests/core/knowledge-graph.test.ts`
- Modify: `tests/hooks/post-tool-use.test.ts`
- Modify: `src/index.ts`

**Step 1: Write failing tests for probe scheduler fixes**

Update `tests/core/probe-scheduler.test.ts` — add tests for Fisher info selection:

```typescript
import { DEFAULT_GRM_PARAMS } from '../../src/schemas/types.js';

describe('selectConceptToProbe (Fisher info)', () => {
  it('uses stability and Fisher information instead of sigma proxy', () => {
    const candidates = [
      { conceptId: 'a', mu: 0.0, sigma: 1.5, stability: 1.0, daysSinceAssessment: 10, itemParams: DEFAULT_GRM_PARAMS },
      { conceptId: 'b', mu: 0.0, sigma: 0.5, stability: 30.0, daysSinceAssessment: 1, itemParams: DEFAULT_GRM_PARAMS },
    ];
    const selected = selectConceptToProbe(candidates);
    expect(selected).toBe('a');
  });

  it('prefers concepts with higher Fisher information', () => {
    const candidates = [
      { conceptId: 'easy', mu: 0.0, sigma: 1.0, stability: 5.0, daysSinceAssessment: 5, itemParams: { discrimination: 0.5, thresholds: [-1, 0, 1] as [number, number, number] } },
      { conceptId: 'hard', mu: 0.0, sigma: 1.0, stability: 5.0, daysSinceAssessment: 5, itemParams: { discrimination: 2.0, thresholds: [-1, 0, 1] as [number, number, number] } },
    ];
    const selected = selectConceptToProbe(candidates);
    expect(selected).toBe('hard');
  });
});
```

**Step 2: Write failing tests for knowledge graph critical novelty**

Update `tests/core/knowledge-graph.test.ts`:

```typescript
import { createConceptNode } from '../../src/schemas/types.js';

describe('classifyNovelty (critical support)', () => {
  it('classifies security concepts as critical regardless of mastery', () => {
    const graph = new KnowledgeGraph();
    const concept = createConceptNode({
      conceptId: 'sql-injection',
      domain: 'security',
      specificity: 'technique',
    });
    graph.addConcept(concept);

    const state = graph.getUserConceptState('user1', 'sql-injection');
    state.mastery.mu = 2.0;
    state.assessmentCount = 5;
    state.lastAssessed = new Date().toISOString();
    state.memory.stability = 30;
    graph.setUserConceptState('user1', 'sql-injection', state);

    const novelty = graph.classifyNovelty('user1', 'sql-injection');
    expect(novelty).toBe('critical');
  });
});

describe('assessment history cap', () => {
  it('caps history at 50 events', () => {
    const graph = new KnowledgeGraph();
    const state = graph.getUserConceptState('user1', 'test-concept');
    // Add 60 events
    for (let i = 0; i < 60; i++) {
      state.history.push({
        timestamp: new Date().toISOString(),
        eventType: 'probe',
        rubricScore: 2,
        evaluatorConfidence: 0.8,
        muBefore: 0,
        muAfter: 0.5,
        probeDepth: 0,
        tutored: false,
      });
    }
    graph.setUserConceptState('user1', 'test-concept', state);
    const saved = graph.getUserConceptState('user1', 'test-concept');
    expect(saved.history.length).toBeLessThanOrEqual(50);
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npm test -- tests/core/probe-scheduler.test.ts tests/core/knowledge-graph.test.ts
```

Expected: FAIL — `selectConceptToProbe` interface doesn't match, `critical` never returned, no history cap.

**Step 4: Implement fixes**

**`src/core/probe-scheduler.ts`** — Update `ProbeCandidateInfo` and use Fisher information:

```typescript
import type { NoveltyLevel, GRMItemParams, DEFAULT_GRM_PARAMS } from '../schemas/types.js';
import { retrievability, grmFisherInformation } from './probabilistic-model.js';

// ... shouldProbe stays the same ...

interface ProbeCandidateInfo {
  conceptId: string;
  mu: number;
  sigma: number;
  stability: number;
  daysSinceAssessment: number;
  itemParams: GRMItemParams;
}

export function selectConceptToProbe(candidates: ProbeCandidateInfo[]): string | null {
  if (candidates.length === 0) return null;

  let bestId: string | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    const fisherInfo = grmFisherInformation(c.mu, c.itemParams);
    const R = retrievability(c.daysSinceAssessment, c.stability);
    const decayBonus = 1 - R;
    const score = fisherInfo * (1 + decayBonus);

    if (score > bestScore) {
      bestScore = score;
      bestId = c.conceptId;
    }
  }

  return bestId;
}
```

**`src/core/knowledge-graph.ts`** — Add critical novelty for security domain + assessment history cap:

In `classifyNovelty()`, before the existing logic, check domain:

```typescript
classifyNovelty(userId: string, conceptId: string): NoveltyLevel {
  const concept = this.state.concepts[conceptId];
  if (concept && concept.domain === 'security') {
    return 'critical';
  }
  // ... rest of existing logic ...
}
```

In `setUserConceptState()`, add cap:

```typescript
setUserConceptState(userId: string, conceptId: string, ucs: UserConceptState): void {
  const key = `${userId}:${conceptId}`;
  if (ucs.history.length > 50) {
    ucs.history = ucs.history.slice(-50);
  }
  this.state.userStates[key] = ucs;
}
```

**`src/hooks/post-tool-use.ts`** — Add `dataDir`/`userId` options and use `selectConceptToProbe`:

- Accept options `{ skipLLM?, dataDir?, userId? }` (parity with `user-prompt-submit.ts`)
- After extracting all concepts, build candidates with proper `stability` and `itemParams`
- Use `selectConceptToProbe(candidates)` instead of probing the first concept

**Step 5: Run tests to verify they pass**

```bash
npm test
```

Expected: All tests PASS.

**Step 6: Commit**

```bash
git add src/core/probe-scheduler.ts src/core/knowledge-graph.ts src/hooks/post-tool-use.ts \
  tests/core/probe-scheduler.test.ts tests/core/knowledge-graph.test.ts tests/hooks/post-tool-use.test.ts
git commit -m "fix: use GRM Fisher info for probe selection, add critical novelty, cap history"
```

---

### Task 7: Hook Integration Updates

**Purpose:** Wire up the new extraction signals (AST, LLM) and GRM update into the existing hooks. PostToolUse should now combine concepts from package + AST signals. UserPromptSubmit should use GRM update instead of the Elo-like update.

**Depends on:** Tasks 2, 3, 4, 5, 6

**Files:**
- Modify: `src/hooks/post-tool-use.ts`
- Modify: `src/hooks/user-prompt-submit.ts`
- Modify: `tests/hooks/post-tool-use.test.ts`
- Modify: `tests/hooks/user-prompt-submit.test.ts`

**Step 1: Write failing tests for updated hooks**

Update `tests/hooks/post-tool-use.test.ts`:

```typescript
it('combines package and AST extraction signals', async () => {
  // When a tool outputs code containing async/await, AST extraction should detect it
  const input = {
    tool_name: 'Bash',
    tool_input: { command: 'npm install redis' },
    tool_output: 'added redis@4',
  };
  const result = await handlePostToolUse(input, { skipLLM: true, dataDir: tmpDir, userId: 'test-user' });
  // Package extraction should detect Redis concepts
  expect(result).toBeDefined();
});
```

Update `tests/hooks/user-prompt-submit.test.ts`:

```typescript
it('uses GRM Bayesian update for scoring', async () => {
  // Set up state with pending probe, then respond
  // Verify the hook completes without error (GRM replaces Elo)
  // The test verifies integration, not GRM math (tested in Task 2)
});
```

**Step 2: Implement hook updates**

**`src/hooks/user-prompt-submit.ts`:**
- Replace `import { bayesianUpdate } from ...` with `import { grmUpdate } from ...`
- Replace `bayesianUpdate(mastery, score)` call with `grmUpdate(mastery, score, concept.itemParams)` where `concept` is the concept being probed (look it up from the knowledge graph using the probe's conceptId)
- If concept is not found (dynamic concept not in taxonomy), fall back to default GRM params

**`src/hooks/post-tool-use.ts`:**
- Import `extractConceptsFromSource, initParser` from `../core/ast-extraction.js`
- After package extraction, if the tool output contains what looks like source code, also run AST extraction
- Combine and deduplicate concepts from both signals (by concept name)
- The LLM extraction signal (`extractConceptsViaLLM`) is only invoked when `skipLLM` is false, and only for prompts/responses (not package installs in Phase 1a — this can be added later)
- Build probe candidates using all extracted concepts, with proper `stability` and `itemParams` from the knowledge graph

**Step 3: Run tests to verify they pass**

```bash
npm test
```

Expected: All tests PASS.

**Step 4: Commit**

```bash
git add src/hooks/post-tool-use.ts src/hooks/user-prompt-submit.ts \
  tests/hooks/post-tool-use.test.ts tests/hooks/user-prompt-submit.test.ts
git commit -m "feat: wire up GRM update and multi-signal extraction into hooks"
```

---

### Task 8: Basic Web Dashboard

**Purpose:** Create a minimal local web dashboard that displays the user's knowledge graph from `.entendi/` JSON files. Shows concepts with mastery levels, novelty status, and assessment history.

**Depends on:** Tasks 1, 3

**Files:**
- Create: `src/dashboard/server.ts`
- Create: `src/dashboard/serve.ts`
- Create: `tests/dashboard/server.test.ts`
- Modify: `package.json` (add hono + @hono/node-server, add dashboard script)

**Step 1: Install hono**

```bash
npm install hono @hono/node-server
```

**Step 2: Write failing tests**

Create `tests/dashboard/server.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Dashboard Server', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'entendi-dash-'));
    mkdirSync(join(tmpDir, '.entendi'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/graph returns knowledge graph state', async () => {
    writeFileSync(join(tmpDir, '.entendi', 'knowledge-graph.json'), JSON.stringify({
      concepts: { 'react': { conceptId: 'react', domain: 'frontend', specificity: 'topic', aliases: [], parentConcept: null, itemParams: { discrimination: 1, thresholds: [-1, 0, 1] }, relationships: [], lifecycle: 'stable', populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 } } },
      userStates: {},
    }));

    const app = createDashboardApp(tmpDir);
    const res = await app.request('/api/graph');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.concepts).toBeDefined();
    expect(data.concepts['react']).toBeDefined();
  });

  it('GET /api/graph returns empty state when no files exist', async () => {
    const app = createDashboardApp(tmpDir);
    const res = await app.request('/api/graph');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.concepts).toEqual({});
  });

  it('GET / returns HTML page', async () => {
    const app = createDashboardApp(tmpDir);
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Entendi');
    expect(html).toContain('<html');
  });

  it('GET /api/stats returns summary statistics', async () => {
    const app = createDashboardApp(tmpDir);
    const res = await app.request('/api/stats');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('totalConcepts');
    expect(data).toHaveProperty('totalUsers');
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npm test -- tests/dashboard/server.test.ts
```

Expected: FAIL — module not found.

**Step 4: Implement dashboard server**

Create `src/dashboard/server.ts`:

```typescript
import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeGraphState } from '../schemas/types.js';
import { createEmptyGraphState } from '../schemas/types.js';

export function createDashboardApp(projectDir: string) {
  const app = new Hono();
  const dataDir = join(projectDir, '.entendi');

  function loadGraph(): KnowledgeGraphState {
    const file = join(dataDir, 'knowledge-graph.json');
    if (!existsSync(file)) return createEmptyGraphState();
    try {
      return JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      return createEmptyGraphState();
    }
  }

  app.get('/api/graph', (c) => c.json(loadGraph()));

  app.get('/api/stats', (c) => {
    const graph = loadGraph();
    const userKeys = new Set(Object.values(graph.userStates).map(s => s.userId));
    return c.json({
      totalConcepts: Object.keys(graph.concepts).length,
      totalUsers: userKeys.size,
      totalAssessments: Object.values(graph.userStates).reduce((sum, s) => sum + s.assessmentCount, 0),
    });
  });

  app.get('/', (c) => c.html(getDashboardHTML()));

  return app;
}
```

The `getDashboardHTML()` function should return a self-contained HTML string with:
- Dark theme (GitHub-style: `#0d1117` bg, `#c9d1d9` text, `#58a6ff` accents)
- Stats cards (total concepts, users, assessments) fetched from `/api/stats`
- Concept grid fetched from `/api/graph`, showing each concept as a card with:
  - Concept name and domain/specificity label
  - Mastery bar (green >70%, yellow >40%, red <40%, gray if unassessed)
  - Mastery percentage text

**IMPORTANT: Use safe DOM APIs (document.createElement, textContent, etc.) instead of innerHTML.** Build DOM elements programmatically:

```javascript
function createStatCard(label, value) {
  const card = document.createElement('div');
  card.className = 'stat-card';
  const valEl = document.createElement('div');
  valEl.className = 'stat-value';
  valEl.textContent = String(value);
  const labelEl = document.createElement('div');
  labelEl.className = 'stat-label';
  labelEl.textContent = label;
  card.appendChild(valEl);
  card.appendChild(labelEl);
  return card;
}
```

Create `src/dashboard/serve.ts` (CLI entry point):

```typescript
import { serve } from '@hono/node-server';
import { createDashboardApp } from './server.js';

const port = parseInt(process.env.PORT ?? '3737', 10);
const projectDir = process.env.ENTENDI_PROJECT_DIR ?? process.cwd();

const app = createDashboardApp(projectDir);
console.log(`Entendi Dashboard running at http://localhost:${port}`);
console.log(`Reading data from: ${projectDir}/.entendi/`);
serve({ fetch: app.fetch, port });
```

Add to `package.json` scripts:

```json
"dashboard": "tsx src/dashboard/serve.ts"
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- tests/dashboard/server.test.ts
```

Expected: All tests PASS.

**Step 6: Run full test suite**

```bash
npm test
```

Expected: All tests PASS.

**Step 7: Commit**

```bash
git add src/dashboard/ tests/dashboard/ package.json package-lock.json
git commit -m "feat: add basic web dashboard with Hono server"
```

---

### Task 9: Integration Tests

**Purpose:** Validate the full Phase 1a assessment loop end-to-end: multi-signal concept extraction, taxonomy lookup, GRM Bayesian update, Fisher-information probe selection, and dashboard serving. All tests run without API key using `skipLLM` mode.

**Depends on:** Tasks 2-8

**Files:**
- Modify: `tests/integration/end-to-end.test.ts`

**Step 1: Write integration tests**

Add to `tests/integration/end-to-end.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handlePostToolUse } from '../../src/hooks/post-tool-use.js';
import { handleUserPromptSubmit } from '../../src/hooks/user-prompt-submit.js';
import { StateManager } from '../../src/core/state-manager.js';
import { KnowledgeGraph } from '../../src/core/knowledge-graph.js';
import { buildSeedConceptNodes } from '../../src/config/seed-taxonomy.js';
import { grmFisherInformation, grmBayesianUpdate } from '../../src/core/probabilistic-model.js';
import { createDashboardApp } from '../../src/dashboard/server.js';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Phase 1a Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'entendi-p1a-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full cycle: install -> probe -> respond -> GRM update -> dashboard', async () => {
    const dataDir = join(tmpDir, '.entendi');

    // 1. Package install triggers probe
    const installResult = await handlePostToolUse(
      { tool_name: 'Bash', tool_input: { command: 'npm install redis' }, tool_output: 'added redis@4' },
      { skipLLM: true, dataDir, userId: 'student1' },
    );
    expect(installResult).toBeDefined();

    // 2. Verify probe was created
    const stateManager = new StateManager(dataDir);
    await stateManager.load();
    expect(stateManager.getProbeSession().pendingProbe).not.toBeNull();

    // 3. User responds
    const respondResult = await handleUserPromptSubmit(
      { user_prompt: 'Redis is an in-memory data store used for caching to reduce database load.' },
      { skipLLM: true, dataDir, userId: 'student1' },
    );
    expect(respondResult).toBeDefined();

    // 4. Verify probe cleared and mastery updated
    await stateManager.load();
    expect(stateManager.getProbeSession().pendingProbe).toBeNull();

    // 5. Dashboard can serve the data
    const app = createDashboardApp(tmpDir);
    const graphRes = await app.request('/api/graph');
    expect(graphRes.status).toBe(200);
    const data = await graphRes.json();
    expect(Object.keys(data.concepts).length).toBeGreaterThan(0);
  });

  it('GRM update produces valid posteriors across rubric scores', () => {
    for (const score of [0, 1, 2, 3] as const) {
      const result = grmBayesianUpdate(score, 0.0, 1.5);
      expect(result.converged).toBe(true);
      expect(Number.isFinite(result.mu)).toBe(true);
      expect(result.sigma).toBeGreaterThan(0);
      expect(result.sigma).toBeLessThanOrEqual(1.5);
    }
  });

  it('Fisher information is consistent across the ability range', () => {
    for (const theta of [-3, -2, -1, 0, 1, 2, 3]) {
      const fi = grmFisherInformation(theta);
      expect(fi).toBeGreaterThan(0);
      expect(Number.isFinite(fi)).toBe(true);
    }
  });

  it('seed taxonomy integrates with knowledge graph', () => {
    const seedNodes = buildSeedConceptNodes();
    const graph = new KnowledgeGraph({ concepts: seedNodes, userStates: {} });

    expect(graph.getAllConcepts().length).toBeGreaterThan(50);

    const asyncConcept = graph.getConcept('async-programming');
    expect(asyncConcept).toBeDefined();
    expect(asyncConcept?.domain).toBe('programming-languages');

    // New user -> novel
    expect(graph.classifyNovelty('newuser', 'async-programming')).toBe('novel');

    // Security concepts -> critical regardless of mastery
    const secConcept = graph.getAllConcepts().find(c => c.domain === 'security');
    if (secConcept) {
      const state = graph.getUserConceptState('user1', secConcept.conceptId);
      state.mastery.mu = 2.0;
      state.assessmentCount = 5;
      state.lastAssessed = new Date().toISOString();
      state.memory.stability = 30;
      graph.setUserConceptState('user1', secConcept.conceptId, state);
      expect(graph.classifyNovelty('user1', secConcept.conceptId)).toBe('critical');
    }
  });
});
```

**Step 2: Run integration tests**

```bash
npm test -- tests/integration/end-to-end.test.ts
```

Expected: All tests PASS.

**Step 3: Run full test suite**

```bash
npm test
```

Expected: All tests PASS (~160 total).

**Step 4: Commit**

```bash
git add tests/integration/end-to-end.test.ts
git commit -m "test: add Phase 1a integration tests for GRM, taxonomy, and dashboard"
```

---

## Summary

| Task | What | New Tests | Files Changed |
|------|------|-----------|--------------|
| 1 | Type extensions (PopulationStats, createConceptNode, TaxonomySeedEntry) | 3 | `types.ts` |
| 2 | GRM + Laplace Bayesian update + Fisher information | ~15 | `probabilistic-model.ts`, `index.ts` |
| 3 | Seed taxonomy (~130 concepts) | ~6 | `seed-taxonomy.ts` (new), `index.ts` |
| 4 | Tree-sitter AST extraction (Signal B) | ~8 | `ast-extraction.ts` (new), `package.json`, `index.ts` |
| 5 | LLM structured output extraction (Signal C) | ~5 | `llm-extraction.ts` (new), `index.ts` |
| 6 | Phase 0 fixes + Fisher probe selection | ~4 | `probe-scheduler.ts`, `knowledge-graph.ts`, `post-tool-use.ts` |
| 7 | Hook integration (GRM + multi-signal) | ~3 | `post-tool-use.ts`, `user-prompt-submit.ts` |
| 8 | Basic web dashboard | ~4 | `dashboard/server.ts` (new), `dashboard/serve.ts` (new), `package.json` |
| 9 | Integration tests | ~4 | `end-to-end.test.ts` |

**Estimated total:** ~50 new tests on top of existing 109 = ~160 tests.
