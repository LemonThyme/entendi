# Entendi Phase 1c Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Entendi from direct Haiku API calls to an MCP server architecture. The MCP server wraps all existing core logic (knowledge graph, probabilistic model, tutor session FSM, probe scheduler) as seven structured tools. Hooks become thin observers (~30 lines each) that detect events and inject `additionalContext` instructions. Claude (the session model) replaces Haiku for all LLM reasoning. Zero extra API cost, no separate API key.

**Architecture:** The MCP server is a long-running stdio process that holds state in memory (flushed to `.entendi/` on disk). Hooks read a `pending-action.json` file for coordination but never write to it. The MCP server owns all state mutations. See `docs/plans/2026-02-25-entendi-phase1c-design.md` for the full design.

**Tech Stack:** TypeScript 5.x, Node.js 22+, Vitest, esbuild, @modelcontextprotocol/sdk, zod

**Base branch:** `main` at HEAD (`700ffe4`)

**Existing tests:** 278 passing across 20 test files

---

## Dependency Graph

```
Task 1 (Types + PendingAction)
  │
  ├──> Task 2 (MCP Server Skeleton) ──┐
  │                                     │
  ├──> Task 3 (entendi_observe)        │── can run after Task 2
  │         │                           │
  │         v                           │
  ├──> Task 4 (entendi_record_evaluation) [depends on Task 3]
  │         │
  │         v
  ├──> Task 5 (Tutor Tools)          [depends on Task 4]
  │         │
  │         v
  ├──> Task 6 (Query Tools)          [can run after Task 2]
  │
  v
Task 7 (Rewrite Hooks)               [depends on Tasks 1, 3-6]
  │
  v
Task 8 (Build + Installation)        [depends on Tasks 2, 7]
  │
  v
Task 9 (Integration Tests)           [depends on all]
```

**Parallel waves:**
- Wave 1: Task 1
- Wave 2: Task 2
- Wave 3: Tasks 3, 6 (parallel)
- Wave 4: Task 4
- Wave 5: Task 5
- Wave 6: Task 7
- Wave 7: Task 8
- Wave 8: Task 9

---

### Task 1: Types + PendingAction Utilities

**Files:**
- Modify: `src/schemas/types.ts`
- Create: `src/mcp/pending-action.ts`
- Test: `tests/mcp/pending-action.test.ts`

**Step 1: Write failing tests for PendingAction type and utilities**

In `tests/mcp/pending-action.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  writePendingAction,
  readPendingAction,
  clearPendingAction,
  type PendingAction,
} from '../../src/mcp/pending-action.js';

describe('PendingAction', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-pa-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('writePendingAction', () => {
    it('writes awaiting_probe_response action to disk', () => {
      const action: PendingAction = {
        type: 'awaiting_probe_response',
        conceptId: 'redis/caching',
        depth: 1,
        timestamp: '2026-02-25T12:00:00.000Z',
      };
      writePendingAction(dataDir, action);

      const filePath = join(dataDir, 'pending-action.json');
      expect(existsSync(filePath)).toBe(true);
      const written = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(written.type).toBe('awaiting_probe_response');
      expect(written.conceptId).toBe('redis/caching');
      expect(written.depth).toBe(1);
    });

    it('writes tutor_offered action to disk', () => {
      const action: PendingAction = {
        type: 'tutor_offered',
        conceptId: 'redis/caching',
        triggerScore: 1,
        timestamp: '2026-02-25T12:00:00.000Z',
      };
      writePendingAction(dataDir, action);
      const read = readPendingAction(dataDir);
      expect(read).not.toBeNull();
      expect(read!.type).toBe('tutor_offered');
      if (read!.type === 'tutor_offered') {
        expect(read!.triggerScore).toBe(1);
      }
    });

    it('writes tutor_active action to disk', () => {
      const action: PendingAction = {
        type: 'tutor_active',
        sessionId: 'tutor_123_abc',
        conceptId: 'redis/caching',
        phase: 'phase2',
        timestamp: '2026-02-25T12:00:00.000Z',
      };
      writePendingAction(dataDir, action);
      const read = readPendingAction(dataDir);
      expect(read).not.toBeNull();
      expect(read!.type).toBe('tutor_active');
      if (read!.type === 'tutor_active') {
        expect(read!.sessionId).toBe('tutor_123_abc');
        expect(read!.phase).toBe('phase2');
      }
    });

    it('overwrites a previous pending action', () => {
      writePendingAction(dataDir, {
        type: 'awaiting_probe_response',
        conceptId: 'redis/caching',
        depth: 1,
        timestamp: '2026-02-25T12:00:00.000Z',
      });
      writePendingAction(dataDir, {
        type: 'tutor_offered',
        conceptId: 'express/middleware',
        triggerScore: 0,
        timestamp: '2026-02-25T12:01:00.000Z',
      });
      const read = readPendingAction(dataDir);
      expect(read!.type).toBe('tutor_offered');
    });
  });

  describe('readPendingAction', () => {
    it('returns null when file does not exist', () => {
      expect(readPendingAction(dataDir)).toBeNull();
    });

    it('returns null when file is corrupted JSON', () => {
      const { writeFileSync, mkdirSync } = require('fs');
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'pending-action.json'), 'not json');
      expect(readPendingAction(dataDir)).toBeNull();
    });

    it('round-trips a valid action', () => {
      const action: PendingAction = {
        type: 'awaiting_probe_response',
        conceptId: 'react/hooks',
        depth: 2,
        timestamp: '2026-02-25T12:00:00.000Z',
      };
      writePendingAction(dataDir, action);
      const read = readPendingAction(dataDir);
      expect(read).toEqual(action);
    });
  });

  describe('clearPendingAction', () => {
    it('removes the pending action file', () => {
      writePendingAction(dataDir, {
        type: 'awaiting_probe_response',
        conceptId: 'redis/caching',
        depth: 1,
        timestamp: '2026-02-25T12:00:00.000Z',
      });
      clearPendingAction(dataDir);
      expect(readPendingAction(dataDir)).toBeNull();
      expect(existsSync(join(dataDir, 'pending-action.json'))).toBe(false);
    });

    it('does not throw when file does not exist', () => {
      expect(() => clearPendingAction(dataDir)).not.toThrow();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/pending-action.test.ts`
Expected: FAIL -- imports not found

**Step 3: Add PendingAction type to `src/schemas/types.ts`**

Append after the `KnowledgeGraphState` section:

```typescript
// --- Pending Action (MCP-Hook IPC) ---
export type PendingAction =
  | { type: 'awaiting_probe_response'; conceptId: string; depth: number; timestamp: string }
  | { type: 'tutor_offered'; conceptId: string; triggerScore: number; timestamp: string }
  | { type: 'tutor_active'; sessionId: string; conceptId: string; phase: TutorPhase; timestamp: string };
```

**Step 4: Implement `src/mcp/pending-action.ts`**

Create `src/mcp/pending-action.ts` with:
- `writePendingAction(dataDir: string, action: PendingAction): void` -- write JSON file with atomic write (write-to-temp + rename)
- `readPendingAction(dataDir: string): PendingAction | null` -- read and parse, return null on error or missing
- `clearPendingAction(dataDir: string): void` -- delete file, no throw on missing

Use `fs.writeFileSync` to a `.tmp` file, then `fs.renameSync` for atomicity. The directory should be created with `mkdirSync({ recursive: true })` if needed.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/pending-action.test.ts`
Expected: ALL PASS

**Step 6: Verify existing tests still pass**

Run: `npx vitest run`
Expected: 278+ tests passing

**Commit:** `feat(phase1c): add PendingAction type and read/write utilities`

---

### Task 2: MCP Server Skeleton

**Files:**
- Modify: `package.json` (add dependencies)
- Create: `src/mcp/server.ts`
- Test: `tests/mcp/server.test.ts`

**Step 1: Install dependencies**

Run: `npm install @modelcontextprotocol/sdk zod`

These become production dependencies because the MCP server ships as a bundled runtime.

**Step 2: Write failing tests for MCP server skeleton**

In `tests/mcp/server.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createEntendiServer } from '../../src/mcp/server.js';

describe('MCP Server Skeleton', () => {
  it('exports createEntendiServer function', () => {
    expect(typeof createEntendiServer).toBe('function');
  });

  it('creates a server with the correct name and version', () => {
    const server = createEntendiServer({ dataDir: '/tmp/test-entendi' });
    expect(server).toBeDefined();
    // Server should have a close/cleanup method or be an object
    expect(typeof server.close).toBe('function');
  });

  it('registers all 7 entendi tools', async () => {
    const server = createEntendiServer({ dataDir: '/tmp/test-entendi' });
    const tools = server.getRegisteredTools();
    const toolNames = tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('entendi_observe');
    expect(toolNames).toContain('entendi_record_evaluation');
    expect(toolNames).toContain('entendi_start_tutor');
    expect(toolNames).toContain('entendi_advance_tutor');
    expect(toolNames).toContain('entendi_dismiss');
    expect(toolNames).toContain('entendi_get_status');
    expect(toolNames).toContain('entendi_get_zpd_frontier');
    expect(toolNames).toHaveLength(7);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: FAIL -- imports not found

**Step 4: Implement `src/mcp/server.ts`**

Create the MCP server with the following structure:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { StateManager } from '../core/state-manager.js';
import { KnowledgeGraph } from '../core/knowledge-graph.js';

export interface EntendiServerOptions {
  dataDir: string;
  userId?: string;
}

export interface EntendiServer {
  close(): Promise<void>;
  getRegisteredTools(): Array<{ name: string }>;
  // Internal access for testing
  getStateManager(): StateManager;
}

export function createEntendiServer(options: EntendiServerOptions): EntendiServer {
  const { dataDir, userId = process.env.ENTENDI_USER_ID ?? process.env.USER ?? 'default' } = options;

  const mcpServer = new McpServer({
    name: 'entendi',
    version: '0.2.0',
  });

  const sm = new StateManager(dataDir, userId);

  // Track registered tools for testing
  const registeredTools: Array<{ name: string }> = [];

  // Register all 7 tools (implementations are stubs initially, filled in Tasks 3-6)
  // Each tool registration records the name for getRegisteredTools()

  // ... register entendi_observe, entendi_record_evaluation, etc. as stubs
  // Each stub returns { content: [{ type: 'text', text: JSON.stringify({ error: 'not implemented' }) }] }

  return {
    close: async () => { sm.save(); },
    getRegisteredTools: () => registeredTools,
    getStateManager: () => sm,
  };
}
```

Register all 7 tools with the `mcpServer.tool()` API. Each tool gets a zod schema for input validation and a stub handler. The `registeredTools` array tracks names. The real implementations come in Tasks 3-6.

Important: The `McpServer.tool()` method from `@modelcontextprotocol/sdk` takes `(name, description, schema, handler)`. Use zod schemas for input validation.

For the `main()` entry point (used when running as a standalone process), add:

```typescript
async function main() {
  const dataDir = process.env.ENTENDI_DATA_DIR ?? '.entendi';
  const server = createEntendiServer({ dataDir });
  const transport = new StdioServerTransport();
  // Connect server to transport
  // ...
}

// Only run main when invoked directly
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`[Entendi MCP] Server error: ${String(err)}\n`);
    process.exit(1);
  });
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/server.test.ts`
Expected: ALL PASS

**Step 6: Verify existing tests still pass**

Run: `npx vitest run`
Expected: 278+ tests passing (plus new tests)

**Commit:** `feat(phase1c): add MCP server skeleton with 7 tool registrations`

---

### Task 3: entendi_observe Tool

**Files:**
- Create: `src/mcp/tools/observe.ts`
- Modify: `src/mcp/server.ts` (wire up real handler)
- Test: `tests/mcp/tools/observe.test.ts`

**Step 1: Write failing tests for the observe tool**

In `tests/mcp/tools/observe.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleObserve, type ObserveInput, type ObserveOutput } from '../../../src/mcp/tools/observe.js';
import { StateManager } from '../../../src/core/state-manager.js';
import { createConceptNode } from '../../../src/schemas/types.js';
import { readPendingAction } from '../../../src/mcp/pending-action.js';

describe('entendi_observe', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-observe-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  // --- Helper to add a concept to the knowledge graph ---
  function addConcept(id: string, domain: string = 'databases') {
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: id,
      domain,
      specificity: 'topic',
    }));
    sm.save();
    // Reload state manager to simulate fresh read
    sm = new StateManager(dataDir, userId);
  }

  it('returns shouldProbe=true for a novel concept', () => {
    addConcept('redis/caching');
    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    // Force probe for deterministic testing
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.shouldProbe).toBe(true);
    expect(result.conceptId).toBe('redis/caching');
    expect(result.depth).toBeDefined();
    expect(result.intrusiveness).toBeDefined();
    expect(['direct', 'woven', 'skip']).toContain(result.intrusiveness);
    expect(result.userProfile).toBeDefined();
    expect(['unknown', 'beginner', 'intermediate', 'advanced']).toContain(result.userProfile);
  });

  it('creates concept in knowledge graph if it does not exist', () => {
    const input: ObserveInput = {
      concepts: [{ id: 'brand-new-concept', source: 'ast' }],
      triggerContext: 'npm install something',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.shouldProbe).toBe(true);
    const kg = sm.getKnowledgeGraph();
    expect(kg.getConcept('brand-new-concept')).toBeDefined();
  });

  it('writes pending-action.json when shouldProbe is true', () => {
    addConcept('redis/caching');
    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    handleObserve(input, sm, userId, { forceProbe: true });
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('awaiting_probe_response');
  });

  it('does not write pending-action when shouldProbe is false (routine concept)', () => {
    addConcept('redis/caching');
    // Mark concept as mastered
    const kg = sm.getKnowledgeGraph();
    const ucs = kg.getUserConceptState(userId, 'redis/caching');
    ucs.mastery = { mu: 3.0, sigma: 0.3 };
    ucs.assessmentCount = 10;
    ucs.lastAssessed = new Date().toISOString();
    kg.setUserConceptState(userId, 'redis/caching', ucs);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    // Don't force probe -- let scheduler decide
    const result = handleObserve(input, sm, userId);
    // Routine concept with high mastery should likely be skipped
    if (!result.shouldProbe) {
      expect(readPendingAction(dataDir)).toBeNull();
    }
  });

  it('returns userProfile=unknown when no concepts have been assessed', () => {
    addConcept('redis/caching');
    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.userProfile).toBe('unknown');
  });

  it('returns userProfile=advanced when average mastery is high', () => {
    // Pre-populate with several mastered concepts
    for (const id of ['concept-a', 'concept-b', 'concept-c']) {
      addConcept(id);
      const kg = sm.getKnowledgeGraph();
      const ucs = kg.getUserConceptState(userId, id);
      ucs.mastery = { mu: 3.0, sigma: 0.3 };
      ucs.assessmentCount = 5;
      ucs.lastAssessed = new Date().toISOString();
      kg.setUserConceptState(userId, id, ucs);
      sm.save();
      sm = new StateManager(dataDir, userId);
    }

    addConcept('new-concept');
    const input: ObserveInput = {
      concepts: [{ id: 'new-concept', source: 'package' }],
      triggerContext: 'npm install something',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.userProfile).toBe('advanced');
  });

  it('computes intrusiveness=woven for advanced user with novel concept', () => {
    // Set up an advanced user
    for (const id of ['concept-a', 'concept-b', 'concept-c']) {
      addConcept(id);
      const kg = sm.getKnowledgeGraph();
      const ucs = kg.getUserConceptState(userId, id);
      ucs.mastery = { mu: 3.0, sigma: 0.3 };
      ucs.assessmentCount = 5;
      ucs.lastAssessed = new Date().toISOString();
      kg.setUserConceptState(userId, id, ucs);
      sm.save();
      sm = new StateManager(dataDir, userId);
    }

    addConcept('novel-concept');
    const input: ObserveInput = {
      concepts: [{ id: 'novel-concept', source: 'package' }],
      triggerContext: 'npm install novel-thing',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.intrusiveness).toBe('woven');
  });

  it('selects highest Fisher information concept when multiple provided', () => {
    addConcept('concept-a');
    addConcept('concept-b');
    // concept-b is at prior (mu=0, sigma=1.5) which has higher Fisher info
    // concept-a is partly mastered (mu=2.0) which has lower Fisher info
    const kg = sm.getKnowledgeGraph();
    const ucsA = kg.getUserConceptState(userId, 'concept-a');
    ucsA.mastery = { mu: 2.0, sigma: 0.5 };
    ucsA.assessmentCount = 3;
    ucsA.lastAssessed = new Date().toISOString();
    kg.setUserConceptState(userId, 'concept-a', ucsA);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: ObserveInput = {
      concepts: [
        { id: 'concept-a', source: 'package' },
        { id: 'concept-b', source: 'ast' },
      ],
      triggerContext: 'npm install something',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    // concept-b at prior should have higher info value
    expect(result.conceptId).toBe('concept-b');
  });

  it('returns guidance string when probing', () => {
    addConcept('redis/caching');
    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    const result = handleObserve(input, sm, userId, { forceProbe: true });
    expect(result.shouldProbe).toBe(true);
    expect(result.guidance).toBeDefined();
    expect(typeof result.guidance).toBe('string');
    expect(result.guidance!.length).toBeGreaterThan(0);
  });

  it('respects rate limit: returns shouldProbe=false when probed recently', () => {
    addConcept('redis/caching');

    // Simulate a recent probe by setting lastProbeTime
    const probeSession = sm.getProbeSession();
    probeSession.lastProbeTime = new Date().toISOString();
    probeSession.probesThisSession = 1;
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: ObserveInput = {
      concepts: [{ id: 'redis/caching', source: 'package' }],
      triggerContext: 'npm install redis',
    };
    // With default minProbeIntervalMinutes=2, a probe just now should be blocked
    const result = handleObserve(input, sm, userId, {
      forceProbe: true,
      config: { minProbeIntervalMinutes: 2, maxProbesPerHour: 15 },
    });
    expect(result.shouldProbe).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools/observe.test.ts`
Expected: FAIL -- imports not found

**Step 3: Implement `src/mcp/tools/observe.ts`**

The `handleObserve` function implements the logic from design doc section 4.1:

1. For each concept in input, ensure it exists in knowledge graph (auto-create if not)
2. Build `ProbeCandidateInfo[]` from all input concepts
3. Call `selectConceptToProbe()` to pick the best concept
4. Classify novelty via `kg.classifyNovelty()`
5. Check rate limits (minProbeIntervalMinutes, maxProbesPerHour) using probe session state
6. Call `shouldProbe()` with novelty level (or `forceProbe` option for testing)
7. Compute user profile from aggregate mastery (`computeUserProfile`)
8. Compute intrusiveness from user profile + novelty (lookup table from design doc section 7)
9. Compute depth from novelty (novel=1, adjacent=2, routine=3)
10. If shouldProbe: write `pending-action.json`, update probe session, save state
11. Return `ObserveOutput`

Export types:

```typescript
export interface ObserveInput {
  concepts: Array<{ id: string; source: 'package' | 'ast' | 'llm' }>;
  triggerContext: string;
}

export interface ObserveOutput {
  shouldProbe: boolean;
  conceptId?: string;
  depth?: 1 | 2 | 3;
  intrusiveness: 'direct' | 'woven' | 'skip';
  guidance?: string;
  userProfile: 'unknown' | 'beginner' | 'intermediate' | 'advanced';
}

export interface ObserveOptions {
  forceProbe?: boolean;
  config?: { minProbeIntervalMinutes: number; maxProbesPerHour: number };
}

export function handleObserve(
  input: ObserveInput,
  sm: StateManager,
  userId: string,
  options?: ObserveOptions,
): ObserveOutput { ... }
```

The `computeUserProfile` function (from design doc section 7):

```typescript
function computeUserProfile(kg: KnowledgeGraph, userId: string): 'unknown' | 'beginner' | 'intermediate' | 'advanced' {
  const allConcepts = kg.getAllConcepts();
  const assessed = allConcepts.filter(c => {
    const ucs = kg.getUserConceptState(userId, c.conceptId);
    return ucs.assessmentCount > 0;
  });
  if (assessed.length === 0) return 'unknown';
  const avgMastery = assessed.reduce((sum, c) => {
    const ucs = kg.getUserConceptState(userId, c.conceptId);
    return sum + pMastery(ucs.mastery.mu);
  }, 0) / assessed.length;
  if (avgMastery > 0.75) return 'advanced';
  if (avgMastery > 0.4) return 'intermediate';
  return 'beginner';
}
```

The intrusiveness lookup table:

```typescript
const INTRUSIVENESS_MAP: Record<string, Record<string, 'direct' | 'woven' | 'skip'>> = {
  unknown:      { novel: 'direct',  adjacent: 'direct', routine: 'skip', critical: 'direct' },
  beginner:     { novel: 'direct',  adjacent: 'woven',  routine: 'skip', critical: 'direct' },
  intermediate: { novel: 'woven',   adjacent: 'woven',  routine: 'skip', critical: 'woven' },
  advanced:     { novel: 'woven',   adjacent: 'skip',   routine: 'skip', critical: 'woven' },
};
```

**Step 4: Wire the handler into `src/mcp/server.ts`**

Replace the `entendi_observe` stub registration with the real handler. Import `handleObserve` and call it inside the MCP tool handler, serializing the result.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools/observe.test.ts`
Expected: ALL PASS

**Step 6: Verify all existing tests still pass**

Run: `npx vitest run`
Expected: 278+ tests passing

**Commit:** `feat(phase1c): implement entendi_observe MCP tool`

---

### Task 4: entendi_record_evaluation Tool

**Files:**
- Create: `src/mcp/tools/record-evaluation.ts`
- Modify: `src/mcp/server.ts` (wire up real handler)
- Test: `tests/mcp/tools/record-evaluation.test.ts`

**Step 1: Write failing tests for record_evaluation**

In `tests/mcp/tools/record-evaluation.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  handleRecordEvaluation,
  type RecordEvaluationInput,
  type RecordEvaluationOutput,
} from '../../../src/mcp/tools/record-evaluation.js';
import { StateManager } from '../../../src/core/state-manager.js';
import { createConceptNode, pMastery } from '../../../src/schemas/types.js';
import { writePendingAction, readPendingAction } from '../../../src/mcp/pending-action.js';
import { loadConfig } from '../../../src/config/config-loader.js';

describe('entendi_record_evaluation', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-eval-'));
    sm = new StateManager(dataDir, userId);
    // Add a concept
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('performs GRM Bayesian update and returns mastery change', () => {
    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 2,
      confidence: 0.8,
      reasoning: 'Good understanding of cache invalidation',
      eventType: 'probe',
    };
    const result = handleRecordEvaluation(input, sm, userId);
    expect(result.mastery).toBeGreaterThan(result.previousMastery);
    expect(typeof result.mastery).toBe('number');
    expect(typeof result.previousMastery).toBe('number');
  });

  it('updates assessment count in knowledge graph', () => {
    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 2,
      confidence: 0.8,
      reasoning: 'Correct',
      eventType: 'probe',
    };
    handleRecordEvaluation(input, sm, userId);
    const ucs = sm.getKnowledgeGraph().getUserConceptState(userId, 'redis/caching');
    expect(ucs.assessmentCount).toBe(1);
    expect(ucs.history).toHaveLength(1);
    expect(ucs.history[0].eventType).toBe('probe');
    expect(ucs.history[0].rubricScore).toBe(2);
  });

  it('updates FSRS memory state on successful recall', () => {
    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 3,
      confidence: 0.9,
      reasoning: 'Deep understanding',
      eventType: 'probe',
    };
    handleRecordEvaluation(input, sm, userId);
    const ucs = sm.getKnowledgeGraph().getUserConceptState(userId, 'redis/caching');
    // FSRS grade 4 (rubric 3 + 1) should increase stability
    expect(ucs.memory.stability).toBeGreaterThan(1.0);
  });

  it('tracks untutored assessment counts for probe events', () => {
    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 2,
      confidence: 0.8,
      reasoning: 'Correct',
      eventType: 'probe',
    };
    handleRecordEvaluation(input, sm, userId);
    const ucs = sm.getKnowledgeGraph().getUserConceptState(userId, 'redis/caching');
    expect(ucs.untutoredAssessmentCount).toBe(1);
    expect(ucs.tutoredAssessmentCount).toBe(0);
  });

  it('tracks tutored assessment counts for tutor_phase4 events', () => {
    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 2,
      confidence: 0.8,
      reasoning: 'Correct after tutoring',
      eventType: 'tutor_phase4',
    };
    handleRecordEvaluation(input, sm, userId);
    const ucs = sm.getKnowledgeGraph().getUserConceptState(userId, 'redis/caching');
    expect(ucs.tutoredAssessmentCount).toBe(1);
    expect(ucs.untutoredAssessmentCount).toBe(0);
  });

  it('returns shouldOfferTutor=true when score is low and tutorMode allows', () => {
    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 0,
      confidence: 0.9,
      reasoning: 'No understanding',
      eventType: 'probe',
    };
    const result = handleRecordEvaluation(input, sm, userId);
    // Default tutorTriggerThreshold is 1, score 0 <= 1, so tutor should be offered
    expect(result.shouldOfferTutor).toBe(true);
  });

  it('returns shouldOfferTutor=false when score is above threshold', () => {
    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 3,
      confidence: 0.9,
      reasoning: 'Deep understanding',
      eventType: 'probe',
    };
    const result = handleRecordEvaluation(input, sm, userId);
    expect(result.shouldOfferTutor).toBe(false);
  });

  it('clears awaiting_probe_response pending action', () => {
    // Set up a pending probe action
    writePendingAction(dataDir, {
      type: 'awaiting_probe_response',
      conceptId: 'redis/caching',
      depth: 1,
      timestamp: new Date().toISOString(),
    });

    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 2,
      confidence: 0.8,
      reasoning: 'Correct',
      eventType: 'probe',
    };
    handleRecordEvaluation(input, sm, userId);
    // Pending action should be cleared (or replaced with tutor_offered)
    const pending = readPendingAction(dataDir);
    if (pending !== null) {
      // If not null, it must be a tutor_offered (when score is low)
      expect(pending.type).toBe('tutor_offered');
    }
  });

  it('writes tutor_offered pending action when shouldOfferTutor', () => {
    writePendingAction(dataDir, {
      type: 'awaiting_probe_response',
      conceptId: 'redis/caching',
      depth: 1,
      timestamp: new Date().toISOString(),
    });

    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 0,
      confidence: 0.9,
      reasoning: 'No understanding',
      eventType: 'probe',
    };
    handleRecordEvaluation(input, sm, userId);
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('tutor_offered');
  });

  it('returns a human-readable message', () => {
    const input: RecordEvaluationInput = {
      conceptId: 'redis/caching',
      score: 2,
      confidence: 0.8,
      reasoning: 'Correct',
      eventType: 'probe',
    };
    const result = handleRecordEvaluation(input, sm, userId);
    expect(result.message).toBeDefined();
    expect(typeof result.message).toBe('string');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools/record-evaluation.test.ts`
Expected: FAIL -- imports not found

**Step 3: Implement `src/mcp/tools/record-evaluation.ts`**

The `handleRecordEvaluation` function reuses the existing `applyMasteryUpdate` logic from `user-prompt-submit.ts` (extract it into a shared utility or reimplement inline):

1. Get user concept state from knowledge graph
2. Apply time decay via `decayPrior` if previously assessed
3. GRM Bayesian update via `grmUpdate`
4. FSRS memory update via `fsrsStabilityAfterSuccess` and `fsrsDifficultyUpdate`
5. Record assessment event in history
6. Handle tutored vs untutored counterfactual tracking
7. Check `shouldOfferTutor` from tutor-session module
8. Clear old pending action, optionally write `tutor_offered`
9. Save state
10. Return result

Export types:

```typescript
export interface RecordEvaluationInput {
  conceptId: string;
  score: 0 | 1 | 2 | 3;
  confidence: number;
  reasoning: string;
  eventType: 'probe' | 'tutor_phase1' | 'tutor_phase4';
}

export interface RecordEvaluationOutput {
  mastery: number;           // P(mastery) after update
  previousMastery: number;
  shouldOfferTutor: boolean;
  message?: string;
}

export function handleRecordEvaluation(
  input: RecordEvaluationInput,
  sm: StateManager,
  userId: string,
  config?: ResolvedConfig,
): RecordEvaluationOutput { ... }
```

Note: Extract the mastery update helper from `src/hooks/user-prompt-submit.ts` into a shared location at `src/core/mastery-update.ts` so both the MCP tools and hooks can reuse it. Or, since the hooks are being rewritten in Task 7, just duplicate the logic in the MCP tool and delete it from hooks later.

**Step 4: Wire the handler into `src/mcp/server.ts`**

Replace the `entendi_record_evaluation` stub with the real handler.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools/record-evaluation.test.ts`
Expected: ALL PASS

**Step 6: Verify all tests still pass**

Run: `npx vitest run`
Expected: 278+ tests passing

**Commit:** `feat(phase1c): implement entendi_record_evaluation MCP tool`

---

### Task 5: Tutor Lifecycle Tools (start_tutor + advance_tutor + dismiss)

**Files:**
- Create: `src/mcp/tools/tutor.ts`
- Modify: `src/mcp/server.ts` (wire up real handlers)
- Test: `tests/mcp/tools/tutor.test.ts`

**Step 1: Write failing tests for tutor tools**

In `tests/mcp/tools/tutor.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  handleStartTutor,
  handleAdvanceTutor,
  handleDismiss,
  type StartTutorInput,
  type AdvanceTutorInput,
  type DismissInput,
} from '../../../src/mcp/tools/tutor.js';
import { StateManager } from '../../../src/core/state-manager.js';
import { createConceptNode, pMastery } from '../../../src/schemas/types.js';
import { readPendingAction, writePendingAction } from '../../../src/mcp/pending-action.js';

describe('entendi_start_tutor', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-tutor-'));
    sm = new StateManager(dataDir, userId);
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates a tutor session at phase1', () => {
    const input: StartTutorInput = {
      conceptId: 'redis/caching',
      triggerScore: 0,
    };
    const result = handleStartTutor(input, sm, userId);
    expect(result.sessionId).toMatch(/^tutor_/);
    expect(result.phase).toBe('phase1');
    expect(result.guidance).toBeDefined();
    expect(typeof result.guidance).toBe('string');
  });

  it('sets tutor session in state manager', () => {
    const input: StartTutorInput = { conceptId: 'redis/caching', triggerScore: 1 };
    const result = handleStartTutor(input, sm, userId);
    const session = sm.getTutorSession();
    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe(result.sessionId);
    expect(session!.phase).toBe('phase1');
  });

  it('writes tutor_active pending action', () => {
    const input: StartTutorInput = { conceptId: 'redis/caching', triggerScore: 0 };
    handleStartTutor(input, sm, userId);
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('tutor_active');
  });

  it('supports proactive start (null triggerScore)', () => {
    const input: StartTutorInput = { conceptId: 'redis/caching', triggerScore: null };
    const result = handleStartTutor(input, sm, userId);
    expect(result.sessionId).toBeDefined();
    expect(result.phase).toBe('phase1');
  });

  it('checks ZPD prerequisites and suggests if needed', () => {
    // Add a prerequisite concept that is not mastered
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({
      conceptId: 'networking/tcp',
      domain: 'networking',
      specificity: 'topic',
    }));
    // Update redis to require networking/tcp
    const redisConcept = kg.getConcept('redis/caching')!;
    redisConcept.relationships = [{ target: 'networking/tcp', type: 'requires' }];
    sm.save();
    sm = new StateManager(dataDir, userId);

    const input: StartTutorInput = { conceptId: 'redis/caching', triggerScore: 0 };
    const result = handleStartTutor(input, sm, userId);
    // Should still create the session but suggest prerequisites
    expect(result.sessionId).toBeDefined();
    if (result.prerequisiteSuggestion) {
      expect(result.prerequisiteSuggestion).toContain('networking/tcp');
    }
  });
});

describe('entendi_advance_tutor', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';
  let sessionId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-advance-'));
    sm = new StateManager(dataDir, userId);
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    // Start a tutor session
    const startResult = handleStartTutor(
      { conceptId: 'redis/caching', triggerScore: 0 },
      sm,
      userId,
    );
    sessionId = startResult.sessionId;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('advances from phase1 to phase2 with score', () => {
    const input: AdvanceTutorInput = {
      sessionId,
      userResponse: 'Redis is a key-value store used for caching',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface understanding',
    };
    const result = handleAdvanceTutor(input, sm, userId);
    expect(result.phase).toBe('phase2');
    expect(result.isComplete).toBe(false);
    expect(result.guidance).toBeDefined();
  });

  it('advances from phase2 to phase3 without score', () => {
    // Phase 1 -> Phase 2
    handleAdvanceTutor({
      sessionId,
      userResponse: 'I know the basics',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface',
    }, sm, userId);

    // Phase 2 -> Phase 3
    const result = handleAdvanceTutor({
      sessionId,
      userResponse: 'It uses an event loop for I/O',
      misconception: 'Redis is single-threaded for all operations',
    }, sm, userId);
    expect(result.phase).toBe('phase3');
    expect(result.isComplete).toBe(false);
  });

  it('advances through all 4 phases to complete', () => {
    // Phase 1 -> Phase 2
    handleAdvanceTutor({
      sessionId,
      userResponse: 'I know some things',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface',
    }, sm, userId);

    // Phase 2 -> Phase 3
    handleAdvanceTutor({
      sessionId,
      userResponse: 'Redis is fast because of memory',
    }, sm, userId);

    // Phase 3 -> Phase 4
    handleAdvanceTutor({
      sessionId,
      userResponse: 'I see, it uses pipelining too',
    }, sm, userId);

    // Phase 4 -> Complete
    const result = handleAdvanceTutor({
      sessionId,
      userResponse: 'Redis caches data in memory with TTL-based eviction',
      score: 3,
      confidence: 0.9,
      reasoning: 'Deep understanding after tutoring',
    }, sm, userId);
    expect(result.phase).toBe('complete');
    expect(result.isComplete).toBe(true);
    expect(result.sessionSummary).toBeDefined();
  });

  it('performs mastery update on phase1 (untutored) and phase4 (tutored)', () => {
    // Phase 1 (untutored assessment)
    handleAdvanceTutor({
      sessionId,
      userResponse: 'I know some things',
      score: 1,
      confidence: 0.7,
      reasoning: 'Surface',
    }, sm, userId);

    const ucsAfterP1 = sm.getKnowledgeGraph().getUserConceptState(userId, 'redis/caching');
    expect(ucsAfterP1.assessmentCount).toBe(1);
    expect(ucsAfterP1.untutoredAssessmentCount).toBe(1);

    // Phase 2 -> Phase 3 -> Phase 4 (no scoring)
    handleAdvanceTutor({ sessionId, userResponse: 'Learned more' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'Understanding deepens' }, sm, userId);

    // Phase 4 (tutored assessment)
    handleAdvanceTutor({
      sessionId,
      userResponse: 'Full explanation',
      score: 3,
      confidence: 0.9,
      reasoning: 'Deep',
    }, sm, userId);

    const ucsAfterP4 = sm.getKnowledgeGraph().getUserConceptState(userId, 'redis/caching');
    expect(ucsAfterP4.assessmentCount).toBe(2);
    expect(ucsAfterP4.tutoredAssessmentCount).toBe(1);
  });

  it('updates pending action on each phase advance', () => {
    handleAdvanceTutor({
      sessionId,
      userResponse: 'Response',
      score: 1,
      confidence: 0.7,
      reasoning: 'OK',
    }, sm, userId);

    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('tutor_active');
    if (pending!.type === 'tutor_active') {
      expect(pending!.phase).toBe('phase2');
    }
  });

  it('clears pending action on completion', () => {
    // Go through all 4 phases
    handleAdvanceTutor({ sessionId, userResponse: 'P1', score: 1, confidence: 0.7, reasoning: 'OK' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P2' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P3' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P4', score: 3, confidence: 0.9, reasoning: 'Good' }, sm, userId);

    const pending = readPendingAction(dataDir);
    expect(pending).toBeNull();
  });

  it('returns masteryUpdate with before/after on scored phases', () => {
    const result = handleAdvanceTutor({
      sessionId,
      userResponse: 'My response',
      score: 2,
      confidence: 0.8,
      reasoning: 'Functional understanding',
    }, sm, userId);
    expect(result.masteryUpdate).toBeDefined();
    expect(typeof result.masteryUpdate!.before).toBe('number');
    expect(typeof result.masteryUpdate!.after).toBe('number');
  });
});

describe('entendi_dismiss', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-dismiss-'));
    sm = new StateManager(dataDir, userId);
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('clears pending action file', () => {
    writePendingAction(dataDir, {
      type: 'awaiting_probe_response',
      conceptId: 'redis/caching',
      depth: 1,
      timestamp: new Date().toISOString(),
    });
    const result = handleDismiss({ reason: 'user_declined' }, sm, userId, dataDir);
    expect(result.acknowledged).toBe(true);
    expect(readPendingAction(dataDir)).toBeNull();
  });

  it('clears active tutor session', () => {
    handleStartTutor({ conceptId: 'redis/caching', triggerScore: 0 }, sm, userId);
    expect(sm.getTutorSession()).not.toBeNull();

    handleDismiss({ reason: 'user_declined' }, sm, userId, dataDir);
    expect(sm.getTutorSession()).toBeNull();
  });

  it('clears pending probe from probe session', () => {
    sm.setPendingProbe({
      probe: {
        probeId: 'probe_123',
        conceptId: 'redis/caching',
        question: 'Test?',
        depth: 0,
        probeType: 'why',
      },
      triggeredAt: new Date().toISOString(),
      triggerContext: 'npm install redis',
      previousResponses: [],
    });
    sm.save();

    handleDismiss({ reason: 'topic_changed' }, sm, userId, dataDir);
    expect(sm.getProbeSession().pendingProbe).toBeNull();
  });

  it('does not throw when nothing is pending', () => {
    const result = handleDismiss({}, sm, userId, dataDir);
    expect(result.acknowledged).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools/tutor.test.ts`
Expected: FAIL -- imports not found

**Step 3: Implement `src/mcp/tools/tutor.ts`**

Three exported handler functions:

**`handleStartTutor`:**
1. Create a `TutorSession` via `createTutorSession(conceptId, triggerScore)`
2. Advance from 'offered' to 'phase1' via `advanceTutorPhase`
3. Check ZPD prerequisites: look up concept's `requires` relationships, check if prerequisites are mastered
4. Generate phase-specific guidance string (e.g., "Assess prior knowledge about {concept}")
5. Write `tutor_active` pending action
6. Set tutor session in state manager, save
7. Return `StartTutorOutput`

**`handleAdvanceTutor`:**
1. Load tutor session from state manager, verify sessionId matches
2. Record user response in the current exchange
3. If current phase is scored (phase1, phase4): perform mastery update using the same logic as Task 4
   - phase1 = untutored (eventType: 'tutor_phase1', tutored: false)
   - phase4 = tutored (eventType: 'tutor_phase4', tutored: true, use `tutoredEvidenceWeight`)
4. Store misconception if provided
5. Advance phase via `advanceTutorPhase`
6. If complete: clear tutor session, clear pending action, generate summary
7. If not complete: generate guidance for next phase, update pending action
8. Save state, return result

**`handleDismiss`:**
1. Clear pending probe from probe session
2. Clear tutor session
3. Clear pending action file
4. Save state
5. Return `{ acknowledged: true }`

Export types:

```typescript
export interface StartTutorInput {
  conceptId: string;
  triggerScore?: 0 | 1 | null;
}
export interface StartTutorOutput {
  sessionId: string;
  phase: 'phase1';
  guidance: string;
  prerequisiteSuggestion?: string;
}

export interface AdvanceTutorInput {
  sessionId: string;
  userResponse: string;
  score?: 0 | 1 | 2 | 3;
  confidence?: number;
  reasoning?: string;
  misconception?: string;
}
export interface AdvanceTutorOutput {
  phase: string;
  isComplete: boolean;
  guidance?: string;
  masteryUpdate?: { before: number; after: number };
  sessionSummary?: string;
}

export interface DismissInput {
  reason?: 'user_declined' | 'topic_changed' | 'timeout';
}
export interface DismissOutput {
  acknowledged: true;
}
```

**Step 4: Wire handlers into `src/mcp/server.ts`**

Replace the stubs for `entendi_start_tutor`, `entendi_advance_tutor`, and `entendi_dismiss` with real handlers.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools/tutor.test.ts`
Expected: ALL PASS

**Step 6: Verify all tests still pass**

Run: `npx vitest run`
Expected: 278+ tests passing

**Commit:** `feat(phase1c): implement tutor lifecycle MCP tools (start, advance, dismiss)`

---

### Task 6: Query Tools (get_status + get_zpd_frontier)

**Files:**
- Create: `src/mcp/tools/query.ts`
- Modify: `src/mcp/server.ts` (wire up real handlers)
- Test: `tests/mcp/tools/query.test.ts`

**Step 1: Write failing tests for query tools**

In `tests/mcp/tools/query.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  handleGetStatus,
  handleGetZPDFrontier,
  type GetStatusInput,
  type GetStatusOutput,
  type GetZPDFrontierOutput,
} from '../../../src/mcp/tools/query.js';
import { StateManager } from '../../../src/core/state-manager.js';
import { createConceptNode, pMastery } from '../../../src/schemas/types.js';

describe('entendi_get_status', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-status-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns overview when no conceptId provided', () => {
    // Add some concepts
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    kg.addConcept(createConceptNode({
      conceptId: 'express/middleware',
      domain: 'web',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetStatus({}, sm, userId);
    expect(result.overview).toBeDefined();
    expect(result.overview!.totalConcepts).toBe(2);
    expect(result.concept).toBeUndefined();
  });

  it('returns concept detail when conceptId provided', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    // Add an assessment
    const ucs = kg.getUserConceptState(userId, 'redis/caching');
    ucs.mastery = { mu: 1.5, sigma: 0.8 };
    ucs.assessmentCount = 3;
    ucs.lastAssessed = '2026-02-25T12:00:00.000Z';
    ucs.tutoredAssessmentCount = 1;
    ucs.untutoredAssessmentCount = 2;
    kg.setUserConceptState(userId, 'redis/caching', ucs);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetStatus({ conceptId: 'redis/caching' }, sm, userId);
    expect(result.concept).toBeDefined();
    expect(result.concept!.mastery).toBeCloseTo(pMastery(1.5), 2);
    expect(result.concept!.sigma).toBeCloseTo(0.8, 2);
    expect(result.concept!.assessmentCount).toBe(3);
    expect(result.concept!.tutoredCount).toBe(1);
    expect(result.concept!.untutoredCount).toBe(2);
    expect(result.overview).toBeUndefined();
  });

  it('overview categorizes concepts as mastered, inProgress, unknown', () => {
    const kg = sm.getKnowledgeGraph();
    // Mastered concept
    kg.addConcept(createConceptNode({ conceptId: 'mastered', domain: 'test', specificity: 'topic' }));
    const masteredUcs = kg.getUserConceptState(userId, 'mastered');
    masteredUcs.mastery = { mu: 3.0, sigma: 0.3 };
    masteredUcs.assessmentCount = 5;
    kg.setUserConceptState(userId, 'mastered', masteredUcs);

    // In-progress concept
    kg.addConcept(createConceptNode({ conceptId: 'in-progress', domain: 'test', specificity: 'topic' }));
    const ipUcs = kg.getUserConceptState(userId, 'in-progress');
    ipUcs.mastery = { mu: 0.5, sigma: 0.8 };
    ipUcs.assessmentCount = 2;
    kg.setUserConceptState(userId, 'in-progress', ipUcs);

    // Unknown concept (never assessed)
    kg.addConcept(createConceptNode({ conceptId: 'unknown', domain: 'test', specificity: 'topic' }));

    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetStatus({}, sm, userId);
    expect(result.overview!.totalConcepts).toBe(3);
    expect(result.overview!.mastered).toBe(1);
    expect(result.overview!.inProgress).toBe(1);
    expect(result.overview!.unknown).toBe(1);
  });

  it('returns empty overview when no concepts exist', () => {
    const result = handleGetStatus({}, sm, userId);
    expect(result.overview!.totalConcepts).toBe(0);
    expect(result.overview!.mastered).toBe(0);
    expect(result.overview!.inProgress).toBe(0);
    expect(result.overview!.unknown).toBe(0);
  });
});

describe('entendi_get_zpd_frontier', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-zpd-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns frontier concepts ready to learn', () => {
    const kg = sm.getKnowledgeGraph();
    // Concept with no prerequisites and low mastery -> in frontier
    kg.addConcept(createConceptNode({ conceptId: 'basics', domain: 'test', specificity: 'topic' }));
    // Mastered concept -> not in frontier
    kg.addConcept(createConceptNode({ conceptId: 'mastered', domain: 'test', specificity: 'topic' }));
    const ucs = kg.getUserConceptState(userId, 'mastered');
    ucs.mastery = { mu: 3.0, sigma: 0.3 };
    ucs.assessmentCount = 5;
    kg.setUserConceptState(userId, 'mastered', ucs);

    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetZPDFrontier(sm, userId);
    expect(result.frontier.length).toBeGreaterThan(0);
    const frontierIds = result.frontier.map(f => f.conceptId);
    expect(frontierIds).toContain('basics');
    expect(frontierIds).not.toContain('mastered');
    expect(result.totalConcepts).toBe(2);
    expect(result.masteredCount).toBe(1);
  });

  it('includes Fisher information for each frontier concept', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'concept-a', domain: 'test', specificity: 'topic' }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetZPDFrontier(sm, userId);
    expect(result.frontier[0].fisherInfo).toBeDefined();
    expect(typeof result.frontier[0].fisherInfo).toBe('number');
    expect(result.frontier[0].fisherInfo).toBeGreaterThan(0);
  });

  it('returns empty frontier when all concepts mastered', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'mastered', domain: 'test', specificity: 'topic' }));
    const ucs = kg.getUserConceptState(userId, 'mastered');
    ucs.mastery = { mu: 3.0, sigma: 0.3 };
    ucs.assessmentCount = 5;
    kg.setUserConceptState(userId, 'mastered', ucs);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetZPDFrontier(sm, userId);
    expect(result.frontier).toHaveLength(0);
    expect(result.masteredCount).toBe(1);
  });

  it('returns empty frontier when no concepts exist', () => {
    const result = handleGetZPDFrontier(sm, userId);
    expect(result.frontier).toHaveLength(0);
    expect(result.totalConcepts).toBe(0);
  });

  it('includes mastery value for each frontier concept', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'concept-a', domain: 'test', specificity: 'topic' }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleGetZPDFrontier(sm, userId);
    expect(result.frontier[0].mastery).toBeDefined();
    expect(typeof result.frontier[0].mastery).toBe('number');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tools/query.test.ts`
Expected: FAIL -- imports not found

**Step 3: Implement `src/mcp/tools/query.ts`**

**`handleGetStatus`:**
- If `conceptId` provided: look up user concept state, return mastery/sigma/assessment details
- If omitted: iterate all concepts, categorize as mastered (pMastery > 0.7), inProgress (assessed but not mastered), unknown (never assessed). Build recent activity from assessment history.

**`handleGetZPDFrontier`:**
- Call `kg.getZPDFrontier(userId)` to get frontier concept IDs
- For each, compute `pMastery` and `grmFisherInformation`
- Count total and mastered concepts
- Return sorted result

Export types:

```typescript
export interface GetStatusInput {
  conceptId?: string;
}

export interface GetStatusOutput {
  concept?: {
    mastery: number;
    sigma: number;
    assessmentCount: number;
    lastAssessed: string | null;
    tutoredCount: number;
    untutoredCount: number;
  };
  overview?: {
    totalConcepts: number;
    mastered: number;
    inProgress: number;
    unknown: number;
    recentActivity: string[];
  };
}

export interface GetZPDFrontierOutput {
  frontier: Array<{ conceptId: string; mastery: number; fisherInfo: number }>;
  totalConcepts: number;
  masteredCount: number;
}
```

**Step 4: Wire handlers into `src/mcp/server.ts`**

Replace stubs for `entendi_get_status` and `entendi_get_zpd_frontier` with real handlers.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/tools/query.test.ts`
Expected: ALL PASS

**Step 6: Verify all tests still pass**

Run: `npx vitest run`
Expected: 278+ tests passing

**Commit:** `feat(phase1c): implement query MCP tools (get_status, get_zpd_frontier)`

---

### Task 7: Rewrite Hooks (Thin Observers)

**Files:**
- Rewrite: `src/hooks/post-tool-use.ts` (~30 lines)
- Rewrite: `src/hooks/user-prompt-submit.ts` (~40 lines)
- Modify: `src/hooks/shared.ts` (if needed)
- Rewrite: `tests/hooks/post-tool-use.test.ts`
- Rewrite: `tests/hooks/user-prompt-submit.test.ts`

**Step 1: Write new tests for thin hooks**

The new hooks are dramatically simpler. Rewrite test files to match.

In `tests/hooks/post-tool-use.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { handlePostToolUse } from '../../src/hooks/post-tool-use.js';

describe('handlePostToolUse (thin)', () => {
  it('returns null for non-Bash tools', async () => {
    const result = await handlePostToolUse({
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/foo.ts' },
    });
    expect(result).toBeNull();
  });

  it('returns null for non-install Bash commands', async () => {
    const result = await handlePostToolUse({
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    });
    expect(result).toBeNull();
  });

  it('returns null for packages not in concept map', async () => {
    const result = await handlePostToolUse({
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install some-unknown-pkg-xyz' },
    });
    expect(result).toBeNull();
  });

  it('detects npm install and injects additionalContext with concept list', async () => {
    const result = await handlePostToolUse({
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install redis' },
    });
    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext;
    expect(ctx).toContain('[Entendi]');
    expect(ctx).toContain('entendi_observe');
    expect(ctx).toContain('redis');
  });

  it('includes AST concepts when tool output looks like code', async () => {
    const result = await handlePostToolUse({
      session_id: 'test',
      cwd: '/tmp',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install express' },
      tool_output: 'import express from "express";\nconst app = express();\napp.use(express.json());\napp.get("/", (req, res) => res.send("ok"));\napp.listen(3000);\nconsole.log("running");',
    });
    // Should still return context even if AST extraction fails/succeeds
    if (result) {
      expect(result.hookSpecificOutput?.additionalContext).toContain('[Entendi]');
    }
  });

  it('does not make any LLM calls', async () => {
    // The thin hook should never import or call @anthropic-ai/sdk
    // Verify by checking the hook completes without ANTHROPIC_API_KEY
    const oldKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result = await handlePostToolUse({
        session_id: 'test',
        cwd: '/tmp',
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm install redis' },
      });
      // Should succeed without API key
      expect(result).toBeDefined();
    } finally {
      if (oldKey) process.env.ANTHROPIC_API_KEY = oldKey;
    }
  });

  it('does not write to .entendi directory', async () => {
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const tmpDir = mkdtempSync(join(tmpdir(), 'entendi-thin-hook-'));

    await handlePostToolUse({
      session_id: 'test',
      cwd: tmpDir,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install redis' },
    });

    // The .entendi directory should NOT be created by the thin hook
    expect(existsSync(join(tmpDir, '.entendi'))).toBe(false);

    const { rmSync } = await import('fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

In `tests/hooks/user-prompt-submit.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleUserPromptSubmit } from '../../src/hooks/user-prompt-submit.js';
import type { PendingAction } from '../../src/schemas/types.js';

describe('handleUserPromptSubmit (thin)', () => {
  let projectDir: string;
  let dataDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'entendi-ups-'));
    dataDir = join(projectDir, '.entendi');
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writePending(action: PendingAction) {
    writeFileSync(join(dataDir, 'pending-action.json'), JSON.stringify(action));
  }

  it('returns null when no pending action exists', async () => {
    const result = await handleUserPromptSubmit({
      session_id: 'test',
      cwd: projectDir,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Hello world',
    });
    expect(result).toBeNull();
  });

  it('injects probe evaluation context for awaiting_probe_response', async () => {
    writePending({
      type: 'awaiting_probe_response',
      conceptId: 'redis/caching',
      depth: 1,
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit({
      session_id: 'test',
      cwd: projectDir,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Redis uses an event loop for non-blocking I/O',
    });

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext;
    expect(ctx).toContain('[Entendi]');
    expect(ctx).toContain('redis/caching');
    expect(ctx).toContain('entendi_record_evaluation');
  });

  it('injects tutor offer context for tutor_offered', async () => {
    writePending({
      type: 'tutor_offered',
      conceptId: 'redis/caching',
      triggerScore: 0,
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit({
      session_id: 'test',
      cwd: projectDir,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'yes',
    });

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext;
    expect(ctx).toContain('[Entendi]');
    expect(ctx).toContain('entendi_start_tutor');
  });

  it('injects dismiss context for tutor_offered decline', async () => {
    writePending({
      type: 'tutor_offered',
      conceptId: 'redis/caching',
      triggerScore: 0,
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit({
      session_id: 'test',
      cwd: projectDir,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'no thanks',
    });

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext;
    expect(ctx).toContain('[Entendi]');
    expect(ctx).toContain('entendi_dismiss');
  });

  it('injects tutor advance context for tutor_active', async () => {
    writePending({
      type: 'tutor_active',
      sessionId: 'tutor_123_abc',
      conceptId: 'redis/caching',
      phase: 'phase2',
      timestamp: new Date().toISOString(),
    });

    const result = await handleUserPromptSubmit({
      session_id: 'test',
      cwd: projectDir,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'I think Redis uses an event loop',
    });

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext;
    expect(ctx).toContain('[Entendi]');
    expect(ctx).toContain('entendi_advance_tutor');
    expect(ctx).toContain('redis/caching');
    expect(ctx).toContain('phase2');
  });

  it('detects "teach me" pattern and injects start_tutor context', async () => {
    // Write a knowledge graph with the concept so pattern matching works
    writeFileSync(
      join(dataDir, 'knowledge-graph.json'),
      JSON.stringify({
        concepts: {
          'redis/caching': {
            conceptId: 'redis/caching',
            aliases: ['redis'],
            domain: 'databases',
            specificity: 'topic',
            parentConcept: null,
            itemParams: { discrimination: 1.0, thresholds: [-1, 0, 1] },
            relationships: [],
            lifecycle: 'validated',
            populationStats: { meanMastery: 0, assessmentCount: 0, failureRate: 0 },
          },
        },
        userStates: {},
      }),
    );

    const result = await handleUserPromptSubmit({
      session_id: 'test',
      cwd: projectDir,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'teach me about redis/caching',
    });

    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext;
    expect(ctx).toContain('[Entendi]');
    expect(ctx).toContain('entendi_start_tutor');
  });

  it('does not make any LLM calls', async () => {
    const oldKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      writePending({
        type: 'awaiting_probe_response',
        conceptId: 'redis/caching',
        depth: 1,
        timestamp: new Date().toISOString(),
      });
      const result = await handleUserPromptSubmit({
        session_id: 'test',
        cwd: projectDir,
        hook_event_name: 'UserPromptSubmit',
        prompt: 'some response',
      });
      expect(result).toBeDefined();
    } finally {
      if (oldKey) process.env.ANTHROPIC_API_KEY = oldKey;
    }
  });

  it('does not write to .entendi directory', async () => {
    const { statSync } = await import('fs');
    const mtimeBefore = statSync(dataDir).mtimeMs;

    writePending({
      type: 'awaiting_probe_response',
      conceptId: 'redis/caching',
      depth: 1,
      timestamp: new Date().toISOString(),
    });
    const mtimeAfterWrite = statSync(dataDir).mtimeMs;

    await handleUserPromptSubmit({
      session_id: 'test',
      cwd: projectDir,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'some response',
    });

    // The hook should not have written any additional files
    // (it only reads pending-action.json and optionally knowledge-graph.json)
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/`
Expected: FAIL -- old tests may fail or new expectations may fail

**Step 3: Rewrite `src/hooks/post-tool-use.ts` as thin observer**

The new hook (~30 lines of logic) should:
1. Check if `tool_name === 'Bash'`
2. Check if command is a package install
3. Extract package names and map to concepts
4. Optionally run AST extraction on tool output (best-effort)
5. If concepts found: return `additionalContext` telling Claude to call `entendi_observe`
6. NO state reads, NO state writes, NO LLM calls

```typescript
// Thin PostToolUse hook — detects concepts, tells Claude to call entendi_observe
export async function handlePostToolUse(input: HookInput): Promise<PostToolUseOutput | null> {
  if (input.tool_name !== 'Bash') return null;
  const command = (input.tool_input as { command?: string })?.command;
  if (!command || !detectPackageInstall(command)) return null;
  const packages = parsePackageFromCommand(command);
  if (packages.length === 0) return null;

  const packageConcepts = packages.flatMap(p => extractConceptsFromPackage(p));
  // ... optionally AST extraction ...

  if (allConcepts.length === 0) return null;

  const conceptList = allConcepts.map(c => `${c.name} (${c.extractionSignal})`).join(', ');
  return {
    hookSpecificOutput: {
      additionalContext: `[Entendi] Concepts detected: ${conceptList}. Trigger: ${command}.\nCall entendi_observe to check if a comprehension probe is appropriate.\nComplete the user's request fully first. Be conversational, not examiner-like.`,
    },
  };
}
```

**Step 4: Rewrite `src/hooks/user-prompt-submit.ts` as thin reader**

The new hook (~40 lines of logic) should:
1. Read `.entendi/pending-action.json` (if missing, go to step 3)
2. Switch on `type`:
   - `awaiting_probe_response`: tell Claude to evaluate and call `entendi_record_evaluation`
   - `tutor_offered`: tell Claude to call `entendi_start_tutor` or `entendi_dismiss`
   - `tutor_active`: tell Claude to advance via `entendi_advance_tutor` or dismiss
3. Check for "teach me about X" pattern (reads knowledge graph concepts for matching)
4. Return `additionalContext` or null

NO LLM calls, NO state writes. Only reads `pending-action.json` and optionally `knowledge-graph.json`.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/`
Expected: ALL PASS

**Step 6: Verify all tests still pass**

Run: `npx vitest run`
Expected: 278+ tests passing (some old hook tests may need removal if they tested LLM-dependent behavior)

Note: Some existing tests in `tests/hooks/` and `tests/integration/` reference the old hook behavior (LLM calls, state writes). These tests must be updated or removed:
- `tests/hooks/post-tool-use.test.ts` — rewrite entirely (done above)
- `tests/hooks/user-prompt-submit.test.ts` — rewrite entirely (done above)
- `tests/integration/end-to-end.test.ts` — keep the integration test patterns but adapt them for Task 9's new MCP-based integration tests. The old integration tests that call hooks directly should be updated to test the thin hooks (no state mutation, just context injection).
- `tests/integration/tutor-flow.test.ts` — same treatment, move to Task 9 MCP integration tests.

**Commit:** `refactor(phase1c): rewrite hooks as thin observers, remove direct LLM calls`

---

### Task 8: Build + Installation Config

**Files:**
- Modify: `esbuild.config.ts` (add MCP server entry point)
- Create: `.claude/settings.local.json` (MCP server registration)
- Modify: `package.json` (add build:mcp script if needed)
- Test: manual build + verify

**Step 1: Write test for build output**

In `tests/mcp/build.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

describe('MCP Server Build', () => {
  it('esbuild config can be loaded', async () => {
    // Just verify the config file is valid TypeScript
    // The actual build is tested via npm run build
    const configPath = join(process.cwd(), 'esbuild.config.ts');
    expect(existsSync(configPath)).toBe(true);
  });

  it('src/mcp/server.ts exists and exports createEntendiServer', async () => {
    const { createEntendiServer } = await import('../../src/mcp/server.js');
    expect(typeof createEntendiServer).toBe('function');
  });
});
```

**Step 2: Update `esbuild.config.ts`**

Add a second build step for the MCP server:

```typescript
// After the hooks build, add MCP server build:
const mcpEntry = join('src', 'mcp', 'server.ts');
if (existsSync(mcpEntry)) {
  await esbuild.build({
    entryPoints: [mcpEntry],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outdir: 'dist/mcp',
    format: 'esm',
    banner: { js: '#!/usr/bin/env node' },
    external: [],  // Bundle everything including @modelcontextprotocol/sdk
  });
}
```

Note: The MCP server should be fully bundled (no external dependencies) so it can run standalone. If `@modelcontextprotocol/sdk` or `zod` cause bundling issues, mark them as external and document that they must be installed.

**Step 3: Create `.claude/settings.local.json`**

```json
{
  "mcpServers": {
    "entendi": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "env": {}
    }
  }
}
```

**Step 4: Build and verify**

Run:
```bash
npm run build
```

Verify:
- `dist/mcp/server.js` exists
- `dist/hooks/post-tool-use.js` exists
- `dist/hooks/user-prompt-submit.js` exists

Run:
```bash
node dist/mcp/server.js --help 2>&1 || true
# Should at least not crash on import
```

**Step 5: Verify tests pass**

Run: `npx vitest run`
Expected: ALL PASS

**Step 6: Verify end-to-end**

Run the build, then verify the MCP server binary starts (it will block on stdin, so test with timeout):

```bash
timeout 2 node dist/mcp/server.js 2>&1 || true
```

Should exit cleanly (no import errors, no crashes).

**Commit:** `build(phase1c): add MCP server to esbuild config and installation`

---

### Task 9: Integration Tests

**Files:**
- Rewrite: `tests/integration/end-to-end.test.ts`
- Rewrite: `tests/integration/tutor-flow.test.ts`
- Create: `tests/mcp/integration.test.ts`

**Step 1: Write MCP-level integration tests**

In `tests/mcp/integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateManager } from '../../src/core/state-manager.js';
import { createConceptNode, pMastery } from '../../src/schemas/types.js';
import { handleObserve } from '../../src/mcp/tools/observe.js';
import { handleRecordEvaluation } from '../../src/mcp/tools/record-evaluation.js';
import { handleStartTutor, handleAdvanceTutor, handleDismiss } from '../../src/mcp/tools/tutor.js';
import { handleGetStatus, handleGetZPDFrontier } from '../../src/mcp/tools/query.js';
import { readPendingAction } from '../../src/mcp/pending-action.js';

describe('MCP Integration: Full Probe Flow', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-int-'));
    sm = new StateManager(dataDir, userId);
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('observe -> record_evaluation: full probe cycle', () => {
    // Step 1: Observe
    const observeResult = handleObserve(
      { concepts: [{ id: 'redis/caching', source: 'package' }], triggerContext: 'npm install redis' },
      sm, userId, { forceProbe: true },
    );
    expect(observeResult.shouldProbe).toBe(true);
    expect(observeResult.conceptId).toBe('redis/caching');

    // Verify pending action was written
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('awaiting_probe_response');

    // Step 2: Record evaluation
    const evalResult = handleRecordEvaluation(
      {
        conceptId: 'redis/caching',
        score: 2,
        confidence: 0.8,
        reasoning: 'Good understanding of caching patterns',
        eventType: 'probe',
      },
      sm, userId,
    );
    expect(evalResult.mastery).toBeGreaterThan(evalResult.previousMastery);
    expect(evalResult.shouldOfferTutor).toBe(false); // score 2 > threshold 1

    // Verify state updated
    const status = handleGetStatus({ conceptId: 'redis/caching' }, sm, userId);
    expect(status.concept!.assessmentCount).toBe(1);
    expect(status.concept!.mastery).toBeGreaterThan(0.5);
  });

  it('observe -> low score -> record_evaluation -> tutor offered', () => {
    const observeResult = handleObserve(
      { concepts: [{ id: 'redis/caching', source: 'package' }], triggerContext: 'npm install redis' },
      sm, userId, { forceProbe: true },
    );
    expect(observeResult.shouldProbe).toBe(true);

    const evalResult = handleRecordEvaluation(
      {
        conceptId: 'redis/caching',
        score: 0,
        confidence: 0.9,
        reasoning: 'No understanding demonstrated',
        eventType: 'probe',
      },
      sm, userId,
    );
    expect(evalResult.shouldOfferTutor).toBe(true);

    // Verify tutor_offered pending action
    const pending = readPendingAction(dataDir);
    expect(pending).not.toBeNull();
    expect(pending!.type).toBe('tutor_offered');
  });
});

describe('MCP Integration: Full Tutor Flow', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-tutor-int-'));
    sm = new StateManager(dataDir, userId);
    sm.getKnowledgeGraph().addConcept(createConceptNode({
      conceptId: 'redis/caching',
      domain: 'databases',
      specificity: 'topic',
    }));
    sm.save();
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('observe -> low score -> start_tutor -> 4 phases -> complete', () => {
    // Observe and get probed
    handleObserve(
      { concepts: [{ id: 'redis/caching', source: 'package' }], triggerContext: 'npm install redis' },
      sm, userId, { forceProbe: true },
    );

    // Low score evaluation
    handleRecordEvaluation(
      { conceptId: 'redis/caching', score: 0, confidence: 0.9, reasoning: 'No understanding', eventType: 'probe' },
      sm, userId,
    );

    // Start tutor
    const startResult = handleStartTutor(
      { conceptId: 'redis/caching', triggerScore: 0 },
      sm, userId,
    );
    expect(startResult.phase).toBe('phase1');
    const sessionId = startResult.sessionId;

    // Phase 1: Assessment (scored, untutored)
    const p1 = handleAdvanceTutor(
      { sessionId, userResponse: 'I think it caches data', score: 1, confidence: 0.7, reasoning: 'Surface' },
      sm, userId,
    );
    expect(p1.phase).toBe('phase2');
    expect(p1.masteryUpdate).toBeDefined();

    // Phase 2: Guided discovery (not scored)
    const p2 = handleAdvanceTutor(
      { sessionId, userResponse: 'Oh, it uses an in-memory data structure' },
      sm, userId,
    );
    expect(p2.phase).toBe('phase3');

    // Phase 3: Rectification (not scored)
    const p3 = handleAdvanceTutor(
      { sessionId, userResponse: 'I see, so TTL is important for cache invalidation' },
      sm, userId,
    );
    expect(p3.phase).toBe('phase4');

    // Phase 4: Consolidation (scored, tutored)
    const p4 = handleAdvanceTutor(
      { sessionId, userResponse: 'Redis caches data in memory with TTL, supports pub/sub...', score: 3, confidence: 0.9, reasoning: 'Deep understanding' },
      sm, userId,
    );
    expect(p4.phase).toBe('complete');
    expect(p4.isComplete).toBe(true);
    expect(p4.sessionSummary).toBeDefined();

    // Verify mastery improved
    const status = handleGetStatus({ conceptId: 'redis/caching' }, sm, userId);
    expect(status.concept!.assessmentCount).toBeGreaterThanOrEqual(3); // probe + phase1 + phase4
    expect(status.concept!.tutoredCount).toBeGreaterThanOrEqual(1);
    expect(status.concept!.untutoredCount).toBeGreaterThanOrEqual(1);

    // Verify pending action cleared
    expect(readPendingAction(dataDir)).toBeNull();
  });

  it('proactive tutor: teach-me -> start_tutor -> complete', () => {
    // Start tutor proactively (no prior probe)
    const startResult = handleStartTutor(
      { conceptId: 'redis/caching', triggerScore: null },
      sm, userId,
    );
    expect(startResult.phase).toBe('phase1');

    const sessionId = startResult.sessionId;

    // Go through all 4 phases
    handleAdvanceTutor({ sessionId, userResponse: 'P1 response', score: 1, confidence: 0.7, reasoning: 'Surface' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P2 response' }, sm, userId);
    handleAdvanceTutor({ sessionId, userResponse: 'P3 response' }, sm, userId);
    const finalResult = handleAdvanceTutor({ sessionId, userResponse: 'P4 response', score: 2, confidence: 0.8, reasoning: 'Functional' }, sm, userId);

    expect(finalResult.isComplete).toBe(true);
  });

  it('dismiss clears tutor mid-session', () => {
    handleStartTutor({ conceptId: 'redis/caching', triggerScore: 0 }, sm, userId);
    expect(sm.getTutorSession()).not.toBeNull();
    expect(readPendingAction(dataDir)).not.toBeNull();

    handleDismiss({ reason: 'user_declined' }, sm, userId, dataDir);
    expect(sm.getTutorSession()).toBeNull();
    expect(readPendingAction(dataDir)).toBeNull();
  });
});

describe('MCP Integration: Intrusiveness Model', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-intrusiveness-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('advanced user gets woven or skip intrusiveness', () => {
    const kg = sm.getKnowledgeGraph();
    // Create an advanced user with many mastered concepts
    for (let i = 0; i < 5; i++) {
      const id = `mastered-concept-${i}`;
      kg.addConcept(createConceptNode({ conceptId: id, domain: 'test', specificity: 'topic' }));
      const ucs = kg.getUserConceptState(userId, id);
      ucs.mastery = { mu: 3.0, sigma: 0.3 };
      ucs.assessmentCount = 5;
      ucs.lastAssessed = new Date().toISOString();
      kg.setUserConceptState(userId, id, ucs);
    }
    // Add a routine concept (also mastered)
    kg.addConcept(createConceptNode({ conceptId: 'routine-concept', domain: 'test', specificity: 'topic' }));
    const routineUcs = kg.getUserConceptState(userId, 'routine-concept');
    routineUcs.mastery = { mu: 3.0, sigma: 0.3 };
    routineUcs.assessmentCount = 10;
    routineUcs.lastAssessed = new Date().toISOString();
    kg.setUserConceptState(userId, 'routine-concept', routineUcs);
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleObserve(
      { concepts: [{ id: 'routine-concept', source: 'package' }], triggerContext: 'npm install something' },
      sm, userId, { forceProbe: true },
    );
    expect(result.userProfile).toBe('advanced');
    // Routine concept for advanced user -> skip
    expect(result.intrusiveness).toBe('skip');
  });

  it('unknown user gets direct intrusiveness for novel concept', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'novel-concept', domain: 'test', specificity: 'topic' }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    const result = handleObserve(
      { concepts: [{ id: 'novel-concept', source: 'package' }], triggerContext: 'npm install something' },
      sm, userId, { forceProbe: true },
    );
    expect(result.userProfile).toBe('unknown');
    expect(result.intrusiveness).toBe('direct');
  });
});

describe('MCP Integration: Query Tools', () => {
  let dataDir: string;
  let sm: StateManager;
  const userId = 'test-user';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'entendi-query-int-'));
    sm = new StateManager(dataDir, userId);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ZPD frontier updates after probe flow', () => {
    const kg = sm.getKnowledgeGraph();
    kg.addConcept(createConceptNode({ conceptId: 'concept-a', domain: 'test', specificity: 'topic' }));
    kg.addConcept(createConceptNode({ conceptId: 'concept-b', domain: 'test', specificity: 'topic' }));
    sm.save();
    sm = new StateManager(dataDir, userId);

    // Both should be in frontier initially
    let frontier = handleGetZPDFrontier(sm, userId);
    expect(frontier.frontier.length).toBe(2);

    // Master concept-a through evaluation
    handleObserve(
      { concepts: [{ id: 'concept-a', source: 'package' }], triggerContext: 'test' },
      sm, userId, { forceProbe: true },
    );
    // Give it a high score multiple times to push mastery up
    for (let i = 0; i < 5; i++) {
      handleRecordEvaluation(
        { conceptId: 'concept-a', score: 3, confidence: 0.95, reasoning: 'Excellent', eventType: 'probe' },
        sm, userId,
      );
    }

    // Now concept-a should be mastered, only concept-b in frontier
    frontier = handleGetZPDFrontier(sm, userId);
    const frontierIds = frontier.frontier.map(f => f.conceptId);
    expect(frontierIds).not.toContain('concept-a');
    expect(frontierIds).toContain('concept-b');
    expect(frontier.masteredCount).toBe(1);
  });
});
```

**Step 2: Update existing integration tests**

Rewrite `tests/integration/end-to-end.test.ts` and `tests/integration/tutor-flow.test.ts` to work with the thin hooks. The old tests tested hooks that made LLM calls and wrote state directly. The new tests should:
- Test thin hooks return correct `additionalContext` strings
- Test MCP tools via direct function calls (as in the new integration test above)
- Remove `skipLLM` dependency since hooks no longer call LLMs

If the old integration tests are difficult to adapt, it is acceptable to replace them entirely with the new MCP-based integration tests in `tests/mcp/integration.test.ts`.

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS (278 original tests may change count due to rewritten test files, but no regressions)

**Step 4: Final verification**

Run:
```bash
npm run build && npx vitest run
```

Expected: Clean build + all tests passing.

**Commit:** `test(phase1c): add MCP integration tests for probe flow, tutor flow, and intrusiveness model`

---

## Summary

| Task | Files | New Tests (approx) | Description |
|------|-------|--------------------|-------------|
| 1 | 3 | ~12 | PendingAction type + read/write/clear utilities |
| 2 | 2 | ~3 | MCP server skeleton with 7 tool registrations |
| 3 | 2 | ~9 | entendi_observe tool |
| 4 | 2 | ~9 | entendi_record_evaluation tool |
| 5 | 2 | ~15 | start_tutor + advance_tutor + dismiss tools |
| 6 | 2 | ~9 | get_status + get_zpd_frontier tools |
| 7 | 4 | ~14 | Thin hook rewrites |
| 8 | 3 | ~2 | Build config + MCP registration |
| 9 | 3 | ~12 | Integration tests |

**Total new/modified files:** ~23
**Total new tests:** ~85
**Estimated final test count:** ~330+ (278 existing + ~85 new, minus tests removed from hook rewrites)

## Key Implementation Notes

1. **Core modules stay unchanged.** `knowledge-graph.ts`, `probabilistic-model.ts`, `probe-scheduler.ts`, `tutor-session.ts`, `concept-extraction.ts`, `ast-extraction.ts` are not modified. The MCP tools import and use them directly.

2. **`@anthropic-ai/sdk` is no longer imported by hooks.** The hooks become pure observers that only use `concept-extraction.ts` and `pending-action.ts`. The `probe-engine.ts` and `tutor-engine.ts` modules still exist but their LLM-calling functions (`generateProbe`, `evaluateResponse`, `generateTutorQuestion`) are no longer called. They can be kept for backward compatibility or cleaned up in a future task.

3. **State management pattern changes.** In Phase 1b, each hook invocation created a `StateManager`, read/mutated/saved state, and exited. In Phase 1c, the MCP server creates one `StateManager` at startup and keeps it alive. The `save()` method is called after each tool handler to flush to disk. The hooks only read `pending-action.json` (never the full state).

4. **The mastery update logic** currently lives in `src/hooks/user-prompt-submit.ts` (`applyMasteryUpdate`). In Phase 1c, this should be extracted to a shared utility (e.g., `src/core/mastery-update.ts`) or duplicated in the MCP tools. Since the hooks are being rewritten, duplication is acceptable for now.

5. **MCP tool handlers are pure functions** that take `(input, stateManager, userId)` and return results. This makes them testable without running an actual MCP server. The `server.ts` file wires them to the MCP protocol layer.

6. **The `pending-action.json` file** is the sole IPC mechanism between the MCP server (writer) and hooks (readers). It uses atomic writes (temp file + rename) to prevent corruption.
