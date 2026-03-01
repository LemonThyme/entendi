# System Reliability Safeguards

**Date**: 2026-03-01
**Status**: Approved
**Approach**: Fail-open with friendly errors

## Problem

The enforcement pipeline has several reliability gaps discovered during live debugging:

1. **Stale pending probes block the observe reminder** — a probe from a previous session prevents observe enforcement in the current session until manually cleared
2. **AskUserQuestion responses look "trivial" to the Stop hook** — structured tool responses are short text that triggers trivial message detection
3. **Stop hook blocking doesn't force recovery** — if the user sends another message before Claude acts on the block, the block is lost
4. **API failure silently disables enforcement** — `fetchPendingAction()` falls back to `enforcement: 'off'` on any network error
5. **UserPromptSubmit has no fetch timeout** — could hang for the full 30s hook timeout
6. **MCP tools surface raw errors** — user sees "Circuit breaker OPEN" which is meaningless
7. **No offline/degraded mode** — everything errors instead of gracefully stepping aside
8. **No user-visible health indicator** — nothing tells the user when Entendi is degraded

## Principle

**Never interfere with the user's work.** If Entendi is down, Claude Code should work exactly as if Entendi wasn't installed. Recovery should be automatic. Errors should be human-readable.

## Section 1: Error Taxonomy

Every error maps to one of these categories with standard handling:

| Category | Examples | Hook Behavior | MCP Behavior |
|----------|----------|---------------|--------------|
| `api_unreachable` | Network error, ECONNREFUSED, timeout | Return `null` (skip Entendi) | Return friendly "unavailable" message |
| `api_error` | 5xx, DB down | Return `null` (skip Entendi) | Return friendly message with detail |
| `auth_failed` | 401, invalid API key | Return `null` | Return "please re-authenticate" message |
| `rate_limited` | 429 | Return `null` | Return "too many requests, try later" |
| `circuit_open` | Circuit breaker tripped | Return `null` | Return "temporarily unavailable" |
| `invalid_input` | Bad params, validation error | N/A | Return specific validation error |

**Hooks always fail silent. MCP tools always fail friendly.**

## Section 2: Hook Hardening

### 2a: UserPromptSubmit Fetch Timeout

Add `AbortSignal.timeout(5000)` to the `fetchPendingAction()` fetch call. Matches the 5s timeout pattern used in all other hooks (stop, notification, session-end, pre-compact).

**File**: `src/hooks/user-prompt-submit.ts`

### 2b: Stale Pending Action Protection

When `fetchPendingAction()` returns a pending action, check `createdAt`. If older than 30 minutes (for `awaiting_probe_response`) or 1 hour (for `tutor_offered`), the API auto-dismisses it server-side and returns `{ pending: null }`.

This is implemented server-side in `GET /pending-action` so all consumers benefit:

```
GET /api/mcp/pending-action
  → Load pending action for user
  → If actionType='awaiting_probe_response' AND createdAt < NOW() - 30min:
      → Auto-dismiss with reason='expired'
      → Return { pending: null, enforcement }
  → If actionType='tutor_offered' AND createdAt < NOW() - 1h:
      → Auto-dismiss with reason='expired'
      → Return { pending: null, enforcement }
  → tutor_active: never auto-expire (can span sessions)
  → deferred_probe: never auto-expire (intentionally re-queued)
```

**Files**: `src/api/routes/mcp.ts`

### 2c: Stop Hook Trivial Detection Fix

The stop hook reads the user message from the transcript, but AskUserQuestion responses are short structured text (`"Fail-Open (Recommended)"`) that looks trivial.

Fix: `UserPromptSubmit` already receives the raw user prompt. Write it to the enforcement cache alongside the enforcement level:

```json
{
  "enforcement": "enforce",
  "ts": 1772398199188,
  "userPrompt": "can we add safeguards?"
}
```

The stop hook reads `userPrompt` from the cache for trivial detection instead of parsing the transcript. Falls back to transcript parsing if the cache field is missing (backwards compatibility).

**Files**: `src/hooks/user-prompt-submit.ts`, `src/hooks/stop.ts`

### 2d: API Failure Should Not Disable Enforcement

Currently `fetchPendingAction()` returns `enforcement: 'off'` on API failure. This means any network glitch silently disables enforcement.

Fix: on API failure, return `enforcement: 'remind'` (the safe default). Additionally, preserve the cached enforcement level from the last successful fetch — don't overwrite it with the failure fallback. Only write to cache on successful API response.

```typescript
// Before (broken)
catch (err) {
  return { pending: null, enforcement: 'off' };
}

// After (safe)
catch (err) {
  log('API unreachable, using safe default');
  return { pending: null, enforcement: 'remind' };
  // Do NOT write to enforcement cache — preserve last known good value
}
```

**Files**: `src/hooks/user-prompt-submit.ts`

### 2e: Stop Hook Observe Verification

Currently the stop hook checks if `entendi_observe` was *called* but not if it *succeeded*. If the tool_result contains an error, observe effectively didn't happen.

Fix: after finding an `entendi_observe` tool_use in the transcript, scan forward for the corresponding tool_result. If the result contains `"isError": true` or an `"error"` field, treat observe as not called.

**Files**: `src/hooks/stop.ts`

## Section 3: MCP Tool Error Wrapping

Wrap all MCP tool handlers with a unified error translator. No raw errors reach the user.

| Raw Error | User-Facing Message |
|-----------|-------------------|
| `Circuit breaker OPEN` | "Entendi is temporarily unavailable. Your work continues normally — concept tracking will resume automatically." |
| `ECONNREFUSED` / `ETIMEDOUT` / `fetch failed` | "Can't reach the Entendi API right now. This doesn't affect your work." |
| `401` / `403` | "Your Entendi session has expired. Run `entendi_login` to re-authenticate." |
| `429` | "Rate limit reached for this concept. Try again later." |
| `500` / `502` / `503` | "Entendi server error. Your work continues normally." |
| Token validation failure | "This probe has expired. A new one will be issued next time." |

Implementation: add a `wrapToolError(err: unknown): string` function in the MCP server that pattern-matches against known error strings and returns the friendly message. Apply it in every tool handler's catch block.

When returning an error, set `{ isError: true }` on the MCP response so the LLM knows not to retry or apologize excessively.

**Files**: `src/mcp/server.ts` (new `wrapToolError` function + update all catch blocks)

## Section 4: Stale Pending Action Lifecycle

### Server-Side Auto-Expiry

Add staleness checks to `GET /pending-action` (described in Section 2b):

| Action Type | Max Age | On Expiry |
|-------------|---------|-----------|
| `awaiting_probe_response` | 30 minutes | Auto-dismiss, reason='expired' |
| `tutor_offered` | 1 hour | Auto-dismiss, reason='expired' |
| `tutor_active` | Never | Tutor sessions can span sessions |
| `deferred_probe` | Never | Intentionally re-queued by user |

### Session-Scoped Pending Actions

Add `sessionId` column to the `pending_actions` table. When `entendi_observe` creates a pending action, record the current session ID.

When `fetchPendingAction()` is called with a different session ID, and the action is `awaiting_probe_response`, auto-dismiss it. This prevents cross-session probe contamination.

Note: session ID is available in hook input (`input.session_id`) and can be passed to the API as a query parameter.

**Files**: `src/api/db/schema.ts`, `src/api/routes/mcp.ts`, `src/hooks/user-prompt-submit.ts`

### Local Dismiss Retry

If `SessionEnd` hook's dismiss API call fails, write a local marker file:

```json
// ~/.entendi/pending-dismiss.json
{
  "conceptId": "oauth",
  "reason": "session_ended",
  "ts": 1772398199188
}
```

Next session's `UserPromptSubmit` checks for this file before calling `fetchPendingAction()`. If found, retries the dismiss, then deletes the file.

**Files**: `src/hooks/session-end.ts`, `src/hooks/user-prompt-submit.ts`

## Section 5: Dashboard Health Indicator

Add a health status banner to the dashboard:

| State | Visual | Condition |
|-------|--------|-----------|
| Healthy | No banner | `/health` returns 200, latency < 2s |
| Degraded | Yellow banner: "API is responding slowly" | `/health` returns 200, latency > 2s |
| Down | Red banner: "Can't reach Entendi API. Data shown may be stale." | `/health` fails or returns 503 |

Implementation: add a lightweight health poll (every 60s) in the dashboard that hits `/health`. Show/hide the banner based on response.

**Files**: Dashboard assets (HTML/JS in `src/dashboard/`)

## Section 6: Data Integrity Safeguards

### Orphan Cleanup

Add cleanup logic that runs as part of the `/health` endpoint (piggyback, no cron needed):

```sql
-- Expired unused probe tokens
DELETE FROM probe_tokens
WHERE used_at IS NULL AND expires_at < NOW();

-- Day-old unresolved probes
DELETE FROM pending_actions
WHERE created_at < NOW() - INTERVAL '24 hours'
AND action_type = 'awaiting_probe_response';
```

Rate-limit the cleanup to run at most once per hour (track last cleanup time in memory).

**Files**: `src/api/index.ts` (health endpoint)

### Concurrent Observe Protection

When upserting a pending action and an existing one is being replaced, mark the old probe token as used with `resolution = 'superseded'`:

```typescript
// In POST /observe, before upsert:
const existing = await db.select().from(pendingActions)
  .where(eq(pendingActions.userId, userId));

if (existing.length > 0 && existing[0].probeTokenId) {
  await db.update(probeTokens)
    .set({ usedAt: new Date() })
    .where(eq(probeTokens.tokenId, existing[0].probeTokenId));
}

// Then upsert new pending action
```

**Files**: `src/api/routes/mcp.ts` (observe endpoint)

### Tutor Session Validation

Before creating a `tutor_active` pending action, verify the tutor session row was successfully inserted. If the insert failed, don't create the pending action.

**Files**: `src/api/routes/mcp.ts` (tutor/start endpoint)

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/hooks/user-prompt-submit.ts` | Add fetch timeout, fix API failure fallback, write userPrompt to cache, local dismiss retry |
| `src/hooks/stop.ts` | Read userPrompt from cache for trivial detection, verify observe success not just invocation |
| `src/hooks/session-end.ts` | Write local dismiss marker on API failure |
| `src/mcp/server.ts` | Add `wrapToolError()`, update all catch blocks |
| `src/api/routes/mcp.ts` | Stale action auto-expiry in pending-action endpoint, sessionId support, concurrent observe protection, tutor validation |
| `src/api/db/schema.ts` | Add `sessionId` column to `pending_actions` |
| `src/dashboard/` | Health poll + status banner |
| `tests/hooks/user-prompt-submit.test.ts` | Tests for timeout, API failure fallback, stale action handling, local dismiss retry |
| `tests/hooks/stop.test.ts` | Tests for userPrompt cache reading, observe success verification |
| `tests/mcp/server.test.ts` | Tests for error wrapping |
| `tests/api/routes/mcp-staleness.test.ts` | Tests for auto-expiry, sessionId filtering, concurrent observe |

## Testing Strategy

### Unit Tests
1. UserPromptSubmit: fetch timeout fires at 5s
2. UserPromptSubmit: API failure returns `enforcement: 'remind'` not `'off'`
3. UserPromptSubmit: stale pending action (>30min) returns `{ pending: null }`
4. UserPromptSubmit: reads and retries local dismiss marker
5. Stop hook: reads userPrompt from cache instead of transcript
6. Stop hook: detects failed observe (tool_result with error)
7. MCP server: each raw error maps to correct friendly message
8. Pending action auto-expiry for each action type
9. Concurrent observe marks old token as superseded
10. Orphan cleanup deletes expired tokens and stale actions

### Integration Tests
11. Full turn: API down → hooks skip silently → MCP tools return friendly error → recovery when API returns
12. Full turn: stale probe from previous session → auto-dismissed → current session gets observe reminder
13. Dashboard: health poll shows correct banner state
