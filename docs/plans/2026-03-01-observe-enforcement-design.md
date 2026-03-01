# Observe Enforcement: Three-Layer Concept Detection

**Date**: 2026-03-01
**Status**: Draft
**Problem**: The concept-detection skill is injected once at session start but the LLM deprioritizes it during task-focused work. In practice, `entendi_observe` is rarely called, meaning concepts go undetected and probes never fire.

## Root Cause

The skill is a 181-line one-shot injection at session start. As conversation context grows, the skill fades in attention. Meanwhile, per-message hook instructions (pending action injections) are reliably followed because they are short, imperative, and injected just-in-time on every message.

Measured data from the ecosystem:
- Skill injection alone: ~20% compliance
- Forced evaluation via UserPromptSubmit: ~84% compliance
- PostToolUse hook (bypass LLM): ~100% capture
- Stop hook safety net: catches remaining ~16%

## Design: Three-Layer Enforcement

```
User types message
    │
    ▼
┌─────────────────────────────────────────┐
│ Layer 2: UserPromptSubmit (proactive)   │
│ Injects mandatory observe reminder      │
│ on every message. 84% first-pass rate.  │
└───────────────┬─────────────────────────┘
                │
                ▼
        Claude processes message
        (may or may not call observe)
                │
                ▼
┌─────────────────────────────────────────┐
│ Layer 1: Stop Hook (safety net)         │
│ Reads transcript. If observe was NOT    │
│ called this turn AND message had        │
│ technical content → block stopping,     │
│ instruct Claude to call observe.        │
│ Catches the remaining ~16%.             │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│ Layer 3: Skill (behavioral guidance)    │
│ Handles probe delivery, formatting,     │
│ evaluation scoring, tutor flow,         │
│ dismiss handling. Unchanged.            │
└─────────────────────────────────────────┘
```

## Enforcement Levels (User/Org Configurable)

Enforcement behavior must be configurable, not hardcoded. Three levels:

| Level | UserPromptSubmit | Stop Hook | Default For |
|-------|-----------------|-----------|-------------|
| `off` | No reminder | No blocking | — |
| `remind` | Injects observe reminder | Logs missed observe (no block) | New users |
| `enforce` | Injects observe reminder | Blocks if observe not called | Orgs that opt in |

### Configuration Source

Follows the existing org metadata pattern (`organization.metadata` JSON). Add an `enforcementLevel` field:

```json
{
  "enforcementLevel": "enforce",
  "integritySettings": { ... }
}
```

**Resolution order** (first wins):
1. User-level preference (future: `user_preferences` table)
2. Org-level setting (`organization.metadata.enforcementLevel`)
3. Default: `"remind"`

### API Changes

Extend the existing `GET /api/mcp/pending-action` response to include enforcement level. The hooks already call this endpoint on every message, so piggybacking avoids an extra API call:

```json
{
  "pending": null,
  "enforcement": "enforce"
}
```

The API resolves the user's effective enforcement level server-side (user pref → org setting → default).

### Org Dashboard

Add enforcement level toggle to the org settings section of the dashboard. Org owners/admins can set the level for their organization.

## Layer 1: Stop Hook — Safety Net

**Purpose**: When enforcement is `"enforce"`, guarantee `entendi_observe` is called every turn by blocking Claude from finishing if it wasn't. When `"remind"`, log the miss but don't block.

**Input**: The Stop hook receives `transcript_path` (JSONL of the full conversation) and `stop_hook_active` (boolean to prevent infinite loops).

**Logic**:

```
1. If stop_hook_active is true → exit 0 (allow stop, prevent infinite loop)
2. Read enforcement level from cached config (set by UserPromptSubmit earlier in the same turn)
3. If enforcement is "off" → exit 0
4. Read transcript from transcript_path
5. Scan the current turn for entendi_observe tool calls
6. If observe WAS called → exit 0 (allow stop)
7. If observe was NOT called:
   a. Check if the user's message was trivial (< 15 chars, or matches trivial patterns)
   b. If trivial → exit 0 (nothing to observe)
   c. If enforcement is "enforce" → return { decision: "block", reason: "..." }
   d. If enforcement is "remind" → log "missed observe" to debug.log, exit 0
```

**Enforcement level caching**: The UserPromptSubmit hook already calls `/api/mcp/pending-action` and gets the enforcement level. It writes it to a temp file (`~/.entendi/enforcement-cache.json`) so the Stop hook can read it without making another API call.

**Constraints**:
- Timeout: 10s (current Stop hook timeout)
- Must read and parse JSONL transcript — could be large in long sessions
- Only scan the last turn (from final user message onward)
- `stop_hook_active` prevents the infinite loop case: if Claude still doesn't call observe after being told to, let it go

**Files**: `src/hooks/stop.ts` (modify existing)

### Transcript Parsing

The transcript is a JSONL file where each line is a JSON object. Tool calls appear as entries with tool use information. We need to scan from the last user message to the end for any `entendi_observe` tool call.

Strategy: read the file, split by newlines, iterate backwards to find the last user message, then scan forward for observe calls. For very large transcripts, read only the last N bytes (e.g., 50KB) to avoid memory issues.

### Trivial Message Detection

Skip observation enforcement for messages that can't contain technical concepts:

```typescript
const TRIVIAL_PATTERNS = [
  /^(yes|no|ok|okay|sure|thanks|thank you|do it|go ahead|sounds good|lgtm|ship it|commit|push|deploy)[\s.!?]*$/i,
  /^.{0,14}$/,  // Messages under 15 characters
];
```

This prevents annoying loops where Claude is forced to observe on "yes" or "ok".

## Layer 2: UserPromptSubmit — Proactive Reminder

**Purpose**: Prime Claude to call observe on its first pass, reducing reliance on the Stop hook.

**Changes**:

1. Fetch enforcement level from the existing `/api/mcp/pending-action` response (piggybacked, no new API call)
2. Cache enforcement level to `~/.entendi/enforcement-cache.json` for the Stop hook
3. If enforcement is not `"off"` and no other context was injected, append the reminder

```typescript
// After all existing checks return null...
if (enforcement !== 'off') {
  return {
    hookSpecificOutput: {
      additionalContext:
        `[Entendi] MANDATORY: After completing the user's request, identify technical ` +
        `concepts discussed and call entendi_observe. Do not skip this step.`,
    },
  };
}
return null;
```

**Key design decisions**:
- Only inject when no other Entendi context is already being injected (pending actions already handle their own flow)
- Keep it short and imperative (proven to work better than long prose)
- Enforcement level fetched for free (piggybacked on existing API call)
- Cache written to temp file for Stop hook to read (avoids second API call)

**Files**: `src/hooks/user-prompt-submit.ts` (modify existing)

## Layer 3: Skill — Behavioral Guidance (Unchanged)

The concept-detection skill (`plugin/skills/concept-detection/SKILL.md`) continues to handle:
- Probe formatting and delivery
- Evaluation scoring (0-3 rubric)
- Probe token handling
- Dismiss handling (topic_change, busy, claimed_expertise)
- Tutor flow management
- Parallel probing guidance

No changes needed. The skill provides the "how" — layers 1 and 2 provide the "you must."

## Interaction Between Layers

### Normal flow (Layer 2 works, ~84% of the time):
1. User sends message
2. UserPromptSubmit injects reminder
3. Claude completes request, calls `entendi_observe`
4. Observe returns `shouldProbe: true/false`
5. If probe needed, Claude probes (guided by skill)
6. Stop hook fires, sees observe was called, exits 0

### Fallback flow (Layer 1 catches, ~16% of the time):
1. User sends message
2. UserPromptSubmit injects reminder
3. Claude completes request, forgets to call observe
4. Stop hook fires, reads transcript, sees no observe call
5. Returns `{ decision: "block", reason: "call entendi_observe" }`
6. Claude calls observe
7. Stop hook fires again with `stop_hook_active: true`, exits 0
8. If probe is needed, it becomes a pending action for the next message

### Trivial message flow:
1. User sends "ok" or "yes"
2. UserPromptSubmit injects reminder (or pending action context)
3. Claude processes trivially
4. Stop hook fires, detects trivial message, exits 0

### Pending action flow (existing, unchanged):
1. User responds to probe
2. UserPromptSubmit injects evaluation context
3. Claude evaluates, calls `entendi_record_evaluation`
4. Stop hook fires, sees no observe call but pending action was handled — exits 0
5. Note: when a pending action is being handled, the reminder is NOT injected (existing logic returns early)

## Edge Cases

### Long sessions / large transcripts
- Read only the last 50KB of the transcript file to bound memory usage
- Parse line by line, don't load entire file into memory

### Subagent sessions
- Subagents don't have the plugin hooks (unless injected via SubagentStart)
- Current behavior: subagents don't observe. This is acceptable — concepts are detected in the main session
- Future: SubagentStart hook could inject a minimal observe reminder

### Context compaction
- When context is compacted, the skill may be lost
- PreCompact hook already preserves probe/tutor state
- The UserPromptSubmit reminder fires on every message regardless, so compaction doesn't affect Layer 2

### Stop hook timeout
- Current timeout: 10s
- Transcript reading should complete in <100ms for most sessions
- If transcript is very large (>1MB), the tail-read approach keeps it fast

### Probe timing after forced observe
- When the Stop hook forces observe and a probe is warranted, the probe becomes a pending action
- The user sees the probe on their NEXT message (one-message delay)
- This is acceptable — better than no probe at all

## Testing Strategy

### Unit tests (stop.ts)
1. `stop_hook_active: true` → exits immediately
2. Transcript with observe call → exits (allows stop)
3. Transcript without observe call, non-trivial message → blocks with reason
4. Transcript without observe call, trivial message → exits (allows stop)
5. Missing/unreadable transcript → exits (graceful failure)
6. Pending action being handled (no observe needed) → exits

### Unit tests (user-prompt-submit.ts)
7. No pending action, no patterns → returns observe reminder
8. Pending action exists → returns pending action context (no reminder)
9. Login pattern → returns login context (no reminder)
10. Teach-me pattern → returns teach-me context (no reminder)

### Integration tests
11. Simulated full turn: message → no observe → stop blocks → observe called → stop allows
12. Simulated full turn: message → observe called → stop allows immediately

## Future: MCP Sampling

When Claude Code adds MCP sampling support (feature request #1785, 84+ upvotes), the architecture can evolve:
- MCP server calls `server.createMessage()` to proactively ask Claude to probe
- The Stop hook becomes unnecessary — the server drives the flow
- Keep layers 2 and 3 as fallbacks

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/hooks/stop.ts` | Add transcript reading, observe detection, enforcement-aware blocking |
| `src/hooks/user-prompt-submit.ts` | Fetch/cache enforcement level, add observe reminder |
| `src/api/routes/mcp.ts` | Extend `GET /api/mcp/pending-action` to return `enforcement` level |
| `src/api/lib/enforcement.ts` | New: resolve effective enforcement level (user → org → default) |
| `src/api/routes/org.ts` | Add org enforcement level GET/PUT endpoints |
| `src/api/db/schema.ts` | No change (enforcement stored in existing `organization.metadata` JSON) |
| `tests/hooks/stop.test.ts` | New tests for observe enforcement with all three levels |
| `tests/hooks/user-prompt-submit.test.ts` | New tests for reminder injection and enforcement caching |
| `tests/api/routes/mcp-enforcement.test.ts` | New tests for enforcement level resolution |
| `plugin/hooks/hooks.json` | No change (Stop hook already configured) |
