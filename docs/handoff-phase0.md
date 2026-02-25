# Entendi Phase 0 — Handoff Document

## Status: COMPLETE (ready for merge to main)

**Branch:** `worktree-luminous-waddling-lantern`
**Base:** `700ffe4` (spec docs only)
**HEAD:** `e8c661b` (11 commits, ~3300 lines)
**Tests:** 109 passing across 10 test files
**Build:** TypeScript strict mode compiles clean; esbuild bundles hooks to `dist/hooks/`

---

## What Was Built

A working Claude Code hooks-based prototype that:
1. **Observes** package installs (npm, pip, cargo, etc.) via PostToolUse hook
2. **Extracts concepts** from packages via a lookup table (~35 packages mapped)
3. **Generates Socratic probes** via Claude Haiku API
4. **Evaluates responses** on a 0-3 rubric via Claude Haiku
5. **Updates a Bayesian knowledge graph** with mastery posteriors + FSRS memory decay
6. **Persists state** to local JSON files in `.entendi/`

---

## Architecture

```
src/
├── schemas/types.ts              # All interfaces, factory functions, union types
├── config/package-concepts.ts    # Package-to-concept lookup table
├── core/
│   ├── probabilistic-model.ts    # Bayesian update (Elo-like Kalman) + FSRS decay
│   ├── knowledge-graph.ts        # In-memory graph, JSON serialization, novelty classification
│   ├── concept-extraction.ts     # Package install detection + concept mapping
│   ├── probe-scheduler.ts        # Novelty-based probe frequency + info-theoretic selection
│   ├── probe-engine.ts           # LLM prompt builders, response parsers, Anthropic API client
│   └── state-manager.ts          # JSON file persistence with corruption recovery
├── hooks/
│   ├── shared.ts                 # stdin reader, data dir, user ID helpers
│   ├── post-tool-use.ts          # Observer: detects installs -> queues probes
│   ├── user-prompt-submit.ts     # Captures probe responses -> Bayesian update
│   └── stop.ts                   # Phase 0 no-op placeholder
└── index.ts                      # Barrel exports
```

### Data Flow

```
[User runs npm install redis]
    |
    v
PostToolUse hook
    -> detectPackageInstall("npm install redis") = true
    -> parsePackageFromCommand -> ["redis"]
    -> extractConceptsFromPackage("redis") -> [Redis, Caching, In-Memory Data Stores]
    -> Ensure concepts exist in knowledge graph
    -> classifyNovelty("user", "Redis") -> 'novel'
    -> shouldProbe('novel') -> true (60% probability)
    -> generateProbe() via Claude Haiku -> "You just added Redis. Why do you need..."
    -> Store as pendingProbe in state
    -> Return additionalContext to Claude Code
    |
    v
[Claude asks the probe question in its response]
[User responds naturally]
    |
    v
UserPromptSubmit hook
    -> Load state, find pendingProbe
    -> evaluateResponse() via Claude Haiku -> {rubricScore: 2, confidence: 0.85}
    -> decayPrior() (time-based regression toward uncertainty)
    -> bayesianUpdate(mastery, score=2) -> updated mu, sigma
    -> fsrsStabilityAfterSuccess() -> updated stability
    -> fsrsDifficultyUpdate() -> updated difficulty
    -> Record AssessmentEvent in history
    -> Clear pendingProbe, save state
    -> Return additionalContext with evaluation summary
```

### Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| TypeScript (not Python) for Phase 0 | Claude Code hooks are shell commands; TS compiles to fast Node.js scripts. Python knowledge engine deferred to Phase 1a. |
| FSRS-4.5 simplified (DECAY=-0.5, FACTOR=19/81) | Simpler than FSRS-6 (21 params); sufficient for Phase 0 prototyping. |
| Elo-like Kalman update (Section 13.1) | Avoids full GRM + Laplace approximation complexity. Converges to reasonable estimates. |
| `skipLLM` option in hooks | Enables full integration testing without Anthropic API key. |
| Lazy Anthropic client via dynamic import | Module can be imported and pure functions used without `ANTHROPIC_API_KEY`. |
| JSON file persistence (not SQLite/Neo4j) | Simplest possible persistence for Phase 0. Files in `.entendi/` directory. |

---

## How to Use

### Prerequisites
- Node.js 22+
- `ANTHROPIC_API_KEY` environment variable (for LLM-powered probing)

### Build
```bash
npm install
npm run build     # tsc + esbuild hooks
npm test          # vitest (109 tests)
```

### Install in a project
Add to your project's `.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "node <ENTENDI_PATH>/dist/hooks/post-tool-use.js", "timeout": 30 }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "node <ENTENDI_PATH>/dist/hooks/user-prompt-submit.js", "timeout": 30 }]
    }]
  }
}
```

See `examples/claude-code-settings.json` for the full template.

---

## Commit History

```
e8c661b fix: address code review findings - error logging, state recovery, cleanup
976fcab Add barrel exports, end-to-end integration test, and example settings
f664088 Add Claude Code hooks for PostToolUse, UserPromptSubmit, and Stop
9356e31 Add state manager with JSON file persistence for knowledge graph and probe session
33af060 Add in-memory knowledge graph with concept CRUD and novelty classification
eba048b Add probe scheduler with novelty-based frequency and Fisher information selection
6f106c4 Add package-based concept extraction with lookup table mapping
2c0d0b1 Add probe engine with LLM-powered probe generation and evaluation
2eb6b69 Add probabilistic model with Bayesian update and FSRS memory functions
6fde97a Add project setup, build tooling, and domain type system
```

---

## Code Review Findings (addressed and remaining)

### Addressed (in e8c661b)
- Hooks now log errors to stderr instead of silently swallowing
- StateManager documents the sequential-execution assumption (race condition)
- StateManager recovers gracefully from corrupted JSON files
- Knowledge graph toJSON() now pretty-prints consistently
- Removed deprecated `ProbeState` type alias

### Remaining (acceptable for Phase 0, fix in Phase 1)
- `selectConceptToProbe` uses sigma as proxy for FSRS stability — should pass actual `memory.stability`
- `'critical'` novelty level is defined but never assigned — needs concept metadata or domain heuristics
- PostToolUse only probes on the first extracted concept — should use `selectConceptToProbe` for best info gain
- PostToolUse options lack `dataDir`/`userId` parity with UserPromptSubmit
- Assessment history grows unboundedly — cap or move to event store in Phase 1
- Anthropic client is a module-level singleton — consider DI for testability in Phase 1

---

## What's Next: Phase 1a

Per the spec (Section 10), Phase 1a scope:
- Full GRM + Laplace approximation (replace Elo-like update)
- Tree-sitter AST extraction (Signal B)
- LLM structured output extraction (Signal C)
- Seed taxonomy (~500 concepts from SWEBOK + ACM CCS)
- Basic web dashboard
- Validate core assessment loop

Key files to modify:
- `src/core/probabilistic-model.ts` — replace `bayesianUpdate` with full GRM
- `src/core/concept-extraction.ts` — add AST and LLM extraction pipelines
- `src/schemas/types.ts` — extend for taxonomy and population stats
- New: `src/core/taxonomy.ts` — seed concept taxonomy
- New: `src/dashboard/` — web dashboard (likely Next.js or similar)

---

## File Inventory

| Path | Lines | Purpose |
|------|-------|---------|
| `src/schemas/types.ts` | 160 | All interfaces and factory functions |
| `src/config/package-concepts.ts` | 210 | Package-to-concept lookup table |
| `src/core/probabilistic-model.ts` | 61 | Bayesian update + FSRS |
| `src/core/knowledge-graph.ts` | 83 | In-memory graph + novelty classification |
| `src/core/concept-extraction.ts` | 170 | Package install detection + mapping |
| `src/core/probe-scheduler.ts` | 44 | Probe frequency + concept selection |
| `src/core/probe-engine.ts` | 260 | LLM prompts, parsers, API client |
| `src/core/state-manager.ts` | 66 | JSON persistence |
| `src/hooks/shared.ts` | 27 | Hook utilities |
| `src/hooks/post-tool-use.ts` | 149 | Observer hook |
| `src/hooks/user-prompt-submit.ts` | 147 | Probe/response hook |
| `src/hooks/stop.ts` | 15 | No-op placeholder |
| `src/index.ts` | 23 | Barrel exports |
| **Total source** | **~1415** | |
| **Total tests** | **~1015** | 109 tests across 10 files |
