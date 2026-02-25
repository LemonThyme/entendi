# Entendi Phase 1c Design — MCP Server Architecture

**Date:** 2026-02-25
**Status:** Approved
**Depends on:** Phase 1b (complete — tutor, config, ZPD, counterfactual)
**Branch:** TBD

---

## 1. Goal

Refactor Entendi from direct Haiku API calls to an MCP server architecture.
Hooks become thin observers (~30 lines each). An MCP server owns all state
(knowledge graph, tutor sessions, config) in-memory. Claude — the session
model the user is already paying for — does all LLM reasoning (probe
generation, evaluation, Socratic dialogue). Zero extra API cost, no separate
API key.

## 2. Design Principles

- **Claude is the LLM.** Don't make separate API calls when the session
  model is right there. MCP tools give Claude structured access to
  Entendi's brain; Claude provides the intelligence.
- **Hooks observe, MCP tools act.** Hooks detect events and inject brief
  instructions. MCP tools mutate state and return guidance. Clean separation.
- **Don't be obnoxious.** Advanced users get probed rarely and casually.
  Unknown users get probed more. Probes never interrupt work — they're
  woven into Claude's natural response after completing the user's request.
- **In-memory state.** The MCP server is a long-running stdio process.
  No more spawn-read-JSON-write-JSON-die per hook invocation. State lives
  in memory, flushed to disk periodically.

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Claude Code Session                    │
│                                                          │
│  ┌─────────────┐    additionalContext    ┌────────────┐  │
│  │   Hooks      │──────────────────────>│   Claude    │  │
│  │  (observe)   │                       │  (reason)   │  │
│  └──────┬───────┘                       └─────┬───────┘  │
│         │ read-only                    tool calls│        │
│         │                                       │        │
│  ┌──────▼───────────────────────────────────────▼─────┐  │
│  │              MCP Server (entendi)                   │  │
│  │  Knowledge graph + Bayesian model + tutor FSM      │  │
│  │  In-memory state, flushed to .entendi/ on disk     │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Three components, each with one job:

- **Hooks** = eyes. Detect events (package installs, user responses),
  inject one-liner instructions into Claude's context. Read
  `pending-action.json` for current state. Never write.
- **MCP server** = brain. Knowledge graph, Bayesian model, tutor state
  machine, probe scheduling, config. All state mutations happen here.
- **Claude** = voice. Generates probe questions, evaluates responses,
  runs Socratic dialogue. Uses Opus/Sonnet quality — better than Haiku.

## 4. MCP Tools

Seven tools exposed by the MCP server:

### 4.1 entendi_observe

Called after PostToolUse hook detects concepts.

```typescript
Input: {
  concepts: Array<{ id: string; source: "package" | "ast" | "llm" }>;
  triggerContext: string;  // "npm install redis"
}

Output: {
  shouldProbe: boolean;
  conceptId?: string;
  depth?: 1 | 2 | 3;
  intrusiveness: "direct" | "woven" | "skip";
  guidance?: string;       // "Ask about cache invalidation strategies"
  userProfile: "unknown" | "beginner" | "intermediate" | "advanced";
}
```

Logic: look up/create concepts in knowledge graph, classify novelty,
check rate limits (maxProbesPerHour, minProbeIntervalMinutes), select
best concept via Fisher information, determine intrusiveness from overall
mastery profile.

Side effect: if `shouldProbe`, writes `pending-action.json` with
`awaiting_probe_response`.

### 4.2 entendi_record_evaluation

Called after Claude evaluates a probe or tutor response.

```typescript
Input: {
  conceptId: string;
  score: 0 | 1 | 2 | 3;
  confidence: number;        // 0-1
  reasoning: string;
  eventType: "probe" | "tutor_phase1" | "tutor_phase4";
}

Output: {
  mastery: number;           // P(mastery) after update
  previousMastery: number;
  shouldOfferTutor: boolean;
  message?: string;          // "Mastery improved from 0.3 → 0.65"
}
```

Logic: GRM Bayesian update, FSRS memory update, counterfactual tracking
(tutored vs untutored), check shouldOfferTutor threshold.

Side effect: updates knowledge graph, clears pending probe, writes
`pending-action.json` with `tutor_offered` if applicable.

### 4.3 entendi_start_tutor

Start a 4-phase Socratic tutor session.

```typescript
Input: {
  conceptId: string;
  triggerScore?: 0 | 1 | null;  // null = proactive ("teach me")
}

Output: {
  sessionId: string;
  phase: "phase1";
  guidance: string;            // "Assess prior knowledge about X"
  prerequisiteSuggestion?: string;  // "Consider teaching Y first"
}
```

Logic: create TutorSession, check ZPD prerequisites, set phase to phase1.

Side effect: writes `pending-action.json` with `tutor_active`.

### 4.4 entendi_advance_tutor

Advance tutor to next phase after user responds.

```typescript
Input: {
  sessionId: string;
  userResponse: string;
  score?: 0 | 1 | 2 | 3;       // required for phase1, phase4
  confidence?: number;
  reasoning?: string;
  misconception?: string;       // detected in phase2/3
}

Output: {
  phase: string;                // next phase or "complete"
  isComplete: boolean;
  guidance?: string;            // phase-specific teaching guidance
  masteryUpdate?: { before: number; after: number };
  sessionSummary?: string;      // on completion
}
```

Logic: record exchange, Bayesian update if scored phase (with
tutoredEvidenceWeight for phase4), advance FSM, generate phase guidance.

Side effect: updates tutor session and `pending-action.json`.

### 4.5 entendi_dismiss

Cancel a pending probe, tutor offer, or abandon a session.

```typescript
Input: {
  reason?: "user_declined" | "topic_changed" | "timeout";
}

Output: { acknowledged: true }
```

Side effect: clears tutor session and `pending-action.json`.

### 4.6 entendi_get_status

Query mastery state.

```typescript
Input: {
  conceptId?: string;    // omit for overview
}

Output: {
  // If conceptId provided:
  concept?: {
    mastery: number; sigma: number; assessmentCount: number;
    lastAssessed: string | null; tutoredCount: number;
    untutoredCount: number;
  };
  // If omitted:
  overview?: {
    totalConcepts: number; mastered: number;
    inProgress: number; unknown: number;
    recentActivity: string[];
  };
}
```

### 4.7 entendi_get_zpd_frontier

Concepts the user is ready to learn next.

```typescript
Input: {}

Output: {
  frontier: Array<{ conceptId: string; mastery: number; fisherInfo: number }>;
  totalConcepts: number;
  masteredCount: number;
}
```

## 5. Hooks (Thin)

### 5.1 PostToolUse Hook

~30 lines. Detects package installs, extracts concepts, injects context.

```
1. Is tool === "Bash"? If not → null
2. Looks like package install? If not → null
3. Extract package names → map to concepts (lookup table + AST)
4. Inject additionalContext:
   "[Entendi] Concepts detected: {list}. Trigger: {command}.
    Call entendi_observe to check if a comprehension probe is appropriate.
    Complete the user's request fully first. Be conversational, not
    examiner-like."
```

No LLM calls. No state writes.

### 5.2 UserPromptSubmit Hook

~40 lines. Reads pending-action, injects appropriate context.

```
1. Read .entendi/pending-action.json (if missing → step 3)
2. Switch on type:
   "awaiting_probe_response" →
     "[Entendi] Pending probe on '{concept}'. If the user is responding,
      evaluate 0-3 and call entendi_record_evaluation. If not, call
      entendi_dismiss."
   "tutor_offered" →
     "[Entendi] Tutor offered for '{concept}'. If user accepts, call
      entendi_start_tutor. If declines, call entendi_dismiss."
   "tutor_active" →
     "[Entendi] Tutor session on '{concept}', {phase}. Evaluate and
      call entendi_advance_tutor. If user says skip, call entendi_dismiss."
3. Check for "teach me about X" pattern → if match:
   "[Entendi] User requested teaching on '{concept}'. Call
    entendi_start_tutor."
4. Return additionalContext or null
```

No LLM calls. No state writes.

## 6. Pending-Action Coordination

The MCP server writes `.entendi/pending-action.json` as a lightweight IPC
channel. Hooks read it (never write). The MCP server clears it when the
action resolves.

```typescript
type PendingAction =
  | { type: "awaiting_probe_response"; conceptId: string;
      depth: number; timestamp: string }
  | { type: "tutor_offered"; conceptId: string;
      triggerScore: number; timestamp: string }
  | { type: "tutor_active"; sessionId: string; conceptId: string;
      phase: TutorPhase; timestamp: string }
  | null  // file deleted = no pending action
```

## 7. Intrusiveness Model

The `entendi_observe` tool computes a user profile from aggregate mastery:

```typescript
function computeUserProfile(userId: string): UserProfile {
  const states = getAllUserConceptStates(userId);
  const assessed = states.filter(s => s.assessmentCount > 0);
  if (assessed.length === 0) return "unknown";
  const avgMastery = mean(assessed.map(s => pMastery(s.mastery.mu)));
  if (avgMastery > 0.75) return "advanced";
  if (avgMastery > 0.4) return "intermediate";
  return "beginner";
}
```

Intrusiveness mapping:

| User Profile | Novel Concept | Adjacent | Routine |
|-------------|--------------|----------|---------|
| unknown     | direct       | direct   | skip    |
| beginner    | direct       | woven    | skip    |
| intermediate| woven        | woven    | skip    |
| advanced    | woven        | skip     | skip    |

Claude receives the intrusiveness level and adapts:
- **direct**: Standalone probe question after completing the task
- **woven**: Weave naturally into the response ("By the way...")
- **skip**: Don't probe

## 8. What Changes From Phase 1b

| Component | Phase 1b | Phase 1c |
|-----------|---------|---------|
| Probe generation | Haiku API call | Claude generates, guided by MCP |
| Response evaluation | Haiku API call | Claude evaluates, records via MCP |
| Tutor questions | Haiku API call | Claude generates, guided by MCP |
| State management | JSON read/write per hook | In-memory MCP server |
| @anthropic-ai/sdk | Required in hooks | Removed from hooks |
| Hook complexity | ~500 lines, routing + Bayesian | ~30 lines, observe + inject |
| LLM quality | Haiku | Opus/Sonnet (session model) |
| API cost | Per-call Haiku charges | Zero (subscription) |

## 9. File Structure

```
src/
├── mcp/
│   ├── server.ts              # NEW: McpServer + StdioTransport
│   └── tools.ts               # NEW: 7 tool handlers
├── core/                      # KEPT: core logic unchanged
│   ├── knowledge-graph.ts
│   ├── probabilistic-model.ts
│   ├── probe-scheduler.ts
│   ├── tutor-session.ts
│   ├── state-manager.ts       # SIMPLIFIED: MCP server uses directly
│   ├── probe-engine.ts        # MODIFIED: keep builders, remove LLM calls
│   ├── tutor-engine.ts        # MODIFIED: keep builders, remove LLM calls
│   ├── concept-extraction.ts
│   └── ast-extraction.ts
├── config/
│   ├── org-policy.ts
│   └── config-loader.ts
├── schemas/
│   └── types.ts               # EXTENDED: PendingAction type
├── hooks/
│   ├── post-tool-use.ts       # REWRITTEN: thin observer
│   ├── user-prompt-submit.ts  # REWRITTEN: thin reader
│   └── shared.ts
└── index.ts
```

## 10. Installation

```bash
# Build hooks + MCP server
npm run build

# Register MCP server (one-time, user scope)
claude mcp add --scope local entendi -- \
  node /path/to/entendi/dist/mcp/server.js

# Hooks in .claude/settings.local.json (same paths as before)
```

## 11. Testing Strategy

- **MCP tool unit tests:** Each tool handler with mock state. Pure
  input→output. No LLM needed.
- **Hook tests:** Verify additionalContext injection for each scenario
  (package install, pending probe, active tutor, teach-me pattern).
- **Integration tests:** Full probe flow and tutor flow with mock state.
- **Existing tests:** 278 core tests stay unchanged (core logic isn't
  modified, just re-wrapped by MCP handlers).

## 12. Out of Scope (Phase 2+)

- MCP Sampling (when Claude Code supports it — issue #1785)
- Entendi server for org policy distribution
- MCP Elicitation for structured user prompts
- Dashboard via MCP resources
- Multi-project knowledge graph aggregation
