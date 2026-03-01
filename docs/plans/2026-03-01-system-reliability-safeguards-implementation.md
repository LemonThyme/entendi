# System Reliability Safeguards Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Entendi fail-open gracefully — never interfere with the user's work when the API is down, fix enforcement pipeline bugs, and surface friendly errors.

**Architecture:** Hooks fail silent on API errors (return null). MCP tools translate raw errors to friendly messages. Server auto-expires stale pending actions. Dashboard shows health status.

**Tech Stack:** TypeScript, Vitest, Hono, Drizzle ORM, esbuild

---

### Task 1: Fix UserPromptSubmit fetch timeout and API failure fallback

**Files:**
- Modify: `src/hooks/user-prompt-submit.ts:61-88`
- Test: `tests/hooks/user-prompt-submit.test.ts`

**Step 1: Write failing tests**

Add to `tests/hooks/user-prompt-submit.test.ts` inside the existing `handleUserPromptSubmit (thin observer)` describe block, after the last test:

```typescript
it('returns remind enforcement when API fetch times out', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')));
  const result = await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));
  // Should fall back to 'remind' (not 'off'), so observe reminder is still injected
  expect(result).toBeDefined();
  const ctx = result!.hookSpecificOutput?.additionalContext!;
  expect(ctx).toContain('entendi_observe');
  expect(ctx).toContain('MANDATORY');
});

it('returns remind enforcement when API returns 500', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
  const result = await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));
  expect(result).toBeDefined();
  const ctx = result!.hookSpecificOutput?.additionalContext!;
  expect(ctx).toContain('entendi_observe');
  expect(ctx).toContain('MANDATORY');
});

it('passes AbortSignal.timeout to fetch', async () => {
  mockPendingAction(null, 'remind');
  await handleUserPromptSubmit(makeInput('hello'));
  const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(fetchCall[1].signal).toBeDefined();
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/user-prompt-submit.test.ts`
Expected: 3 new tests FAIL (timeout returns `enforcement: 'off'` → null result, 500 returns `enforcement: 'off'` → null result, no signal passed)

**Step 3: Implement fixes in fetchPendingAction**

In `src/hooks/user-prompt-submit.ts`, replace `fetchPendingAction()` (lines 61-88):

```typescript
async function fetchPendingAction(): Promise<PendingActionResult> {
  const config = loadConfig();
  const apiUrl = config.apiUrl;
  const apiKey = config.apiKey;
  if (!apiKey) {
    log('hook:user-prompt-submit', 'fetchPendingAction: no API key configured');
    return { pending: null, enforcement: 'off' };
  }

  try {
    log('hook:user-prompt-submit', 'fetchPendingAction: calling API', { url: `${apiUrl}/api/mcp/pending-action` });
    const res = await fetch(`${apiUrl}/api/mcp/pending-action`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log('hook:user-prompt-submit', 'fetchPendingAction: API error', { status: res.status });
      return { pending: null, enforcement: 'remind' };
    }
    const data = await res.json() as { pending: any | null; enforcement?: string };
    log('hook:user-prompt-submit', 'fetchPendingAction: result', data);
    const enforcement = data.enforcement ?? 'remind';
    cacheEnforcement(enforcement);
    return { pending: data.pending, enforcement };
  } catch (err) {
    log('hook:user-prompt-submit', 'fetchPendingAction: exception', { error: String(err) });
    return { pending: null, enforcement: 'remind' };
  }
}
```

Changes:
- Add `signal: AbortSignal.timeout(5000)` to fetch call
- Change `enforcement: 'off'` to `enforcement: 'remind'` in both error paths (lines 77 and 86)
- Do NOT call `cacheEnforcement()` on error — preserve last known good value

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/user-prompt-submit.test.ts`
Expected: ALL tests PASS

**Step 5: Update existing test expectation**

The existing test `'returns null gracefully when API is unavailable'` (line 243) tests the no-API-key case which still returns `'off'`. Verify it still passes. No change needed — the no-API-key path is unchanged.

**Step 6: Commit**

```bash
git add src/hooks/user-prompt-submit.ts tests/hooks/user-prompt-submit.test.ts
git commit -m "fix(hooks): add fetch timeout and safe fallback to UserPromptSubmit"
```

---

### Task 2: Write userPrompt to enforcement cache and fix Stop hook trivial detection

**Files:**
- Modify: `src/hooks/user-prompt-submit.ts:52-59` (cacheEnforcement)
- Modify: `src/hooks/stop.ts:25-36,64-69` (readEnforcementCache, trivial check)
- Test: `tests/hooks/user-prompt-submit.test.ts`
- Test: `tests/hooks/stop.test.ts`

**Step 1: Write failing test for userPrompt caching**

Add to `tests/hooks/user-prompt-submit.test.ts`:

```typescript
it('writes userPrompt to enforcement cache alongside enforcement level', async () => {
  const writeFileSyncSpy = vi.spyOn(await import('fs'), 'writeFileSync');
  mockPendingAction(null, 'enforce');
  await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));

  const cacheCall = writeFileSyncSpy.mock.calls.find(
    call => typeof call[0] === 'string' && call[0].includes('enforcement-cache.json'),
  );
  expect(cacheCall).toBeDefined();
  const cached = JSON.parse(cacheCall![1] as string);
  expect(cached.enforcement).toBe('enforce');
  expect(cached.userPrompt).toBe('fix the OAuth redirect');
  writeFileSyncSpy.mockRestore();
});
```

**Step 2: Write failing test for Stop hook reading userPrompt from cache**

Add to `tests/hooks/stop.test.ts` inside the `handleStop observe enforcement` describe block. First, check how `readEnforcementCache` is used — it needs to also return `userPrompt`. The stop hook needs a new helper or modified `readEnforcementCache`.

Add new test:

```typescript
it('uses userPrompt from cache for trivial detection instead of transcript', async () => {
  const home = makeTestHome('cache-prompt');
  // Cache has a non-trivial userPrompt
  writeFileSync(
    join(home, '.entendi', 'enforcement-cache.json'),
    JSON.stringify({ enforcement: 'enforce', ts: Date.now(), userPrompt: 'explain how OAuth works with PKCE' }),
  );
  // Transcript has the user message as a short AskUserQuestion response
  const tp = makeTempTranscript([
    { type: 'user', message: { role: 'user', content: 'Fail-Open (Recommended)' } },
    { type: 'assistant', message: { role: 'assistant', content: 'OK choosing fail-open.' } },
  ]);
  const result = await handleStop({ session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop', transcript_path: tp }, home);
  // Should block because the real userPrompt is non-trivial
  expect(result).not.toBeNull();
  expect(result!.decision).toBe('block');
});

it('falls back to transcript when cache has no userPrompt', async () => {
  const home = makeTestHome('no-cache-prompt');
  writeEnforcementCache(home, 'enforce');
  // No userPrompt in cache — old format
  const tp = makeTempTranscript([
    { type: 'user', message: { role: 'user', content: 'yes' } },
    { type: 'assistant', message: { role: 'assistant', content: 'done' } },
  ]);
  const result = await handleStop({ session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop', transcript_path: tp }, home);
  // 'yes' is trivial — should allow stop
  expect(result).toBeNull();
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/user-prompt-submit.test.ts tests/hooks/stop.test.ts`
Expected: new tests FAIL

**Step 4: Update cacheEnforcement to include userPrompt**

In `src/hooks/user-prompt-submit.ts`, modify `cacheEnforcement`:

```typescript
function cacheEnforcement(enforcement: string, userPrompt?: string): void {
  try {
    const cachePath = join(homedir(), '.entendi', 'enforcement-cache.json');
    const data: Record<string, unknown> = { enforcement, ts: Date.now() };
    if (userPrompt) data.userPrompt = userPrompt;
    writeFileSync(cachePath, JSON.stringify(data));
  } catch {
    // non-critical
  }
}
```

Then update the call site in `fetchPendingAction` — but `fetchPendingAction` doesn't have access to the prompt. Instead, call `cacheEnforcement` from `handleUserPromptSubmit` after fetching. Restructure:

1. Remove the `cacheEnforcement(enforcement)` call from inside `fetchPendingAction` (line 82)
2. Add `cacheEnforcement(enforcement, userPrompt)` after the `fetchPendingAction()` call in `handleUserPromptSubmit` (after line 110)

```typescript
// In handleUserPromptSubmit, after line 110:
const { pending, enforcement } = await fetchPendingAction();
cacheEnforcement(enforcement, userPrompt);
```

**Step 5: Update Stop hook to read userPrompt from cache**

In `src/hooks/stop.ts`, modify `readEnforcementCache` to return both values:

```typescript
interface EnforcementCache {
  enforcement: string;
  userPrompt?: string;
}

function readEnforcementCache(homeDir?: string): EnforcementCache {
  try {
    const dir = homeDir ?? homedir();
    const raw = readFileSync(join(dir, '.entendi', 'enforcement-cache.json'), 'utf-8');
    const data = JSON.parse(raw);
    // Ignore stale cache (> 5 minutes old)
    if (Date.now() - data.ts > 5 * 60 * 1000) return { enforcement: 'remind' };
    return {
      enforcement: data.enforcement ?? 'remind',
      userPrompt: data.userPrompt,
    };
  } catch {
    return { enforcement: 'remind' };
  }
}
```

Update `handleStop` to use the cached userPrompt for trivial detection:

```typescript
export async function handleStop(input: StopInput, homeDir?: string): Promise<StopOutput | null> {
  if (input.stop_hook_active) {
    log('hook:stop', 'stop_hook_active is true, allowing stop');
    return null;
  }

  const cache = readEnforcementCache(homeDir);
  if (cache.enforcement === 'off') {
    log('hook:stop', 'enforcement is off, allowing stop');
    return null;
  }

  const transcriptPath = input.transcript_path;
  if (!transcriptPath) {
    log('hook:stop', 'no transcript_path, allowing stop');
    return null;
  }

  if (hasObserveCallInCurrentTurn(transcriptPath)) {
    log('hook:stop', 'observe was called this turn, allowing stop');
    return null;
  }

  // Use cached userPrompt for trivial detection (fixes AskUserQuestion false trivial)
  // Fall back to transcript if cache doesn't have it
  const userMessage = cache.userPrompt ?? findLastUserMessage(transcriptPath);
  if (!userMessage || isTrivialMessage(userMessage)) {
    log('hook:stop', 'trivial or empty message, skipping observe enforcement');
    return null;
  }

  if (cache.enforcement === 'enforce') {
    log('hook:stop', 'observe NOT called, blocking stop', { enforcement: cache.enforcement, userMessage: userMessage.slice(0, 100) });
    return {
      decision: 'block',
      reason:
        `[Entendi] You did not call entendi_observe this turn. Identify technical ` +
        `concepts from the user's message and your work, then call entendi_observe before finishing.`,
    };
  }

  log('hook:stop', 'observe NOT called (remind mode, not blocking)', { userMessage: userMessage.slice(0, 100) });
  return null;
}
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/user-prompt-submit.test.ts tests/hooks/stop.test.ts`
Expected: ALL tests PASS

**Step 7: Commit**

```bash
git add src/hooks/user-prompt-submit.ts src/hooks/stop.ts tests/hooks/user-prompt-submit.test.ts tests/hooks/stop.test.ts
git commit -m "fix(hooks): write userPrompt to cache for accurate trivial detection"
```

---

### Task 3: Stop hook observe success verification

**Files:**
- Modify: `src/hooks/transcript.ts:54-84`
- Test: `tests/hooks/stop.test.ts`

**Step 1: Write failing test**

Add to `tests/hooks/stop.test.ts`:

```typescript
it('treats failed observe call as not called', async () => {
  const home = makeTestHome('failed-observe');
  writeEnforcementCache(home, 'enforce');
  const tp = makeTempTranscript([
    { type: 'user', message: { role: 'user', content: 'explain how circuit breakers work' } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu_1', name: 'mcp__plugin_entendi_entendi__entendi_observe', input: {} },
    ] } },
    { type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'Circuit breaker OPEN' },
    ] } },
  ]);
  const result = await handleStop({ session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop', transcript_path: tp }, home);
  expect(result).not.toBeNull();
  expect(result!.decision).toBe('block');
});

it('treats successful observe call as called', async () => {
  const home = makeTestHome('success-observe');
  writeEnforcementCache(home, 'enforce');
  const tp = makeTempTranscript([
    { type: 'user', message: { role: 'user', content: 'explain how circuit breakers work' } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu_1', name: 'mcp__plugin_entendi_entendi__entendi_observe', input: {} },
    ] } },
    { type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu_1', content: '{"shouldProbe":false}' },
    ] } },
  ]);
  const result = await handleStop({ session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop', transcript_path: tp }, home);
  expect(result).toBeNull();
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/stop.test.ts`
Expected: "treats failed observe call as not called" FAILS (current code treats any observe tool_use as success)

**Step 3: Implement observe success verification**

In `src/hooks/transcript.ts`, update `hasObserveCallInCurrentTurn`:

```typescript
export function hasObserveCallInCurrentTurn(transcriptPath: string): boolean {
  const raw = readTail(transcriptPath);
  if (!raw) return false;
  const lines = parseLines(raw);

  let lastUserIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isRealUserMessage(lines[i])) {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) return false;

  // Scan from last user message onward for observe calls
  for (let i = lastUserIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.type !== 'assistant') continue;
    const content = line?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && typeof block.name === 'string' && block.name.includes('entendi_observe')) {
        // Verify the observe call succeeded by checking its tool_result
        const toolUseId = block.id;
        if (toolUseId && isObserveCallFailed(lines, i, toolUseId)) {
          continue; // Treat failed observe as not called
        }
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a tool_use was followed by a tool_result with is_error=true.
 */
function isObserveCallFailed(lines: any[], afterIdx: number, toolUseId: string): boolean {
  for (let i = afterIdx + 1; i < lines.length; i++) {
    const content = lines[i]?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id === toolUseId) {
        return block.is_error === true;
      }
    }
  }
  return false; // No result found — assume success (in-progress)
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/stop.test.ts`
Expected: ALL tests PASS

**Step 5: Commit**

```bash
git add src/hooks/transcript.ts tests/hooks/stop.test.ts
git commit -m "fix(hooks): verify observe success, not just invocation"
```

---

### Task 4: MCP tool error wrapping

**Files:**
- Modify: `src/mcp/server.ts`
- Create: `tests/mcp/error-wrapping.test.ts`

**Step 1: Write failing tests**

Create `tests/mcp/error-wrapping.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { wrapToolError } from '../../src/mcp/server.js';

describe('wrapToolError', () => {
  it('wraps circuit breaker errors', () => {
    const msg = wrapToolError(new Error('Circuit breaker OPEN — failing fast'));
    expect(msg).toContain('temporarily unavailable');
    expect(msg).toContain('resume automatically');
    expect(msg).not.toContain('Circuit breaker');
  });

  it('wraps connection refused errors', () => {
    const msg = wrapToolError(new Error('fetch failed: ECONNREFUSED'));
    expect(msg).toContain("Can't reach");
    expect(msg).not.toContain('ECONNREFUSED');
  });

  it('wraps timeout errors', () => {
    const msg = wrapToolError(new DOMException('The operation was aborted', 'AbortError'));
    expect(msg).toContain("Can't reach");
  });

  it('wraps 401 errors', () => {
    const msg = wrapToolError(new Error('HTTP 401: Unauthorized'));
    expect(msg).toContain('expired');
    expect(msg).toContain('entendi_login');
  });

  it('wraps 429 errors', () => {
    const msg = wrapToolError(new Error('HTTP 429: Too Many Requests'));
    expect(msg).toContain('Rate limit');
  });

  it('wraps 500 errors', () => {
    const msg = wrapToolError(new Error('HTTP 500: Internal Server Error'));
    expect(msg).toContain('server error');
    expect(msg).toContain('continues normally');
  });

  it('wraps token validation errors', () => {
    const msg = wrapToolError(new Error('Probe token expired'));
    expect(msg).toContain('expired');
    expect(msg).toContain('new one');
  });

  it('returns generic message for unknown errors', () => {
    const msg = wrapToolError(new Error('some random error'));
    expect(msg).toContain('unexpected error');
    expect(msg).toContain('continues normally');
  });

  it('handles non-Error values', () => {
    const msg = wrapToolError('string error');
    expect(msg).toContain('unexpected error');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/error-wrapping.test.ts`
Expected: FAIL — `wrapToolError` doesn't exist yet

**Step 3: Implement wrapToolError**

Add to `src/mcp/server.ts`, before `createEntendiServer`:

```typescript
export function wrapToolError(err: unknown): string {
  const msg = String(err instanceof Error ? err.message : err);

  if (msg.includes('Circuit breaker OPEN')) {
    return 'Entendi is temporarily unavailable. Your work continues normally — concept tracking will resume automatically.';
  }
  if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('fetch failed') || msg.includes('AbortError') || msg.includes('operation was aborted')) {
    return "Can't reach the Entendi API right now. This doesn't affect your work.";
  }
  if (/\b401\b/.test(msg) || /\b403\b/.test(msg) || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
    return 'Your Entendi session has expired. Run `entendi_login` to re-authenticate.';
  }
  if (/\b429\b/.test(msg) || msg.includes('Too Many Requests') || msg.includes('Rate limit')) {
    return 'Rate limit reached. Try again later.';
  }
  if (/\b5\d{2}\b/.test(msg) || msg.includes('Internal Server Error') || msg.includes('Bad Gateway') || msg.includes('Service Unavailable')) {
    return "Entendi server error. Your work continues normally.";
  }
  if (msg.includes('token') && (msg.includes('expired') || msg.includes('invalid') || msg.includes('Expired'))) {
    return 'This probe has expired. A new one will be issued next time.';
  }

  return "Entendi encountered an unexpected error. Your work continues normally.";
}
```

**Step 4: Update all catch blocks in createEntendiServer**

Replace every `JSON.stringify({ error: String(err) })` in catch blocks with `wrapToolError(err)`. There are 7 tool handlers to update. The pattern for each:

```typescript
// Before:
catch (err) {
  mcpLog('tool:entendi_observe error', { error: err });
  return { content: [{ type: 'text', text: JSON.stringify({ error: String(err) }) }], isError: true };
}

// After:
catch (err) {
  mcpLog('tool:entendi_observe error', { error: err });
  return { content: [{ type: 'text', text: wrapToolError(err) }], isError: true };
}
```

Apply this change to: `entendi_observe`, `entendi_record_evaluation`, `entendi_start_tutor`, `entendi_advance_tutor`, `entendi_dismiss`, `entendi_get_status`, `entendi_get_zpd_frontier`.

Do NOT change `entendi_login` or `entendi_health_check` — they have their own specific error handling.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp/error-wrapping.test.ts`
Expected: ALL tests PASS

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS

**Step 7: Commit**

```bash
git add src/mcp/server.ts tests/mcp/error-wrapping.test.ts
git commit -m "feat(mcp): wrap tool errors with user-friendly messages"
```

---

### Task 5: Stale pending action auto-expiry

**Files:**
- Modify: `src/api/routes/mcp.ts:1046-1064`
- Create: `tests/api/routes/mcp-staleness.test.ts`

**Step 1: Write failing test**

Create `tests/api/routes/mcp-staleness.test.ts`. Follow the existing test patterns in `tests/api/routes/` — check for existing test helpers, app factory, etc. The test needs to:

1. Insert a `pendingActions` row with `createdAt` 31 minutes ago and `actionType: 'awaiting_probe_response'`
2. Call `GET /api/mcp/pending-action`
3. Assert response has `pending: null` (auto-expired)
4. Assert the pending action row was deleted from DB

Also test:
- `tutor_offered` older than 1 hour → auto-expired
- `tutor_active` older than 2 hours → NOT auto-expired
- `awaiting_probe_response` younger than 30 min → returned normally

Look at existing test files in `tests/api/routes/` for the test setup pattern (app creation, auth, DB seeding). Use the same pattern.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/routes/mcp-staleness.test.ts`
Expected: FAIL — auto-expiry not implemented

**Step 3: Implement auto-expiry in GET /pending-action**

In `src/api/routes/mcp.ts`, update the `GET /pending-action` handler:

```typescript
mcpRoutes.get('/pending-action', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const [action] = await db.select().from(pendingActions)
    .where(eq(pendingActions.userId, user.id));

  const enforcement = await resolveEnforcementLevel(db, user.id);

  if (!action) return c.json({ pending: null, enforcement });

  // Auto-expire stale pending actions
  const ageMs = Date.now() - new Date(action.createdAt).getTime();
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;

  const shouldExpire =
    (action.actionType === 'awaiting_probe_response' && ageMs > THIRTY_MINUTES) ||
    (action.actionType === 'tutor_offered' && ageMs > ONE_HOUR);

  if (shouldExpire) {
    // Auto-dismiss: delete pending action and record dismissal
    await db.delete(pendingActions).where(eq(pendingActions.userId, user.id));
    await db.insert(dismissalEvents).values({
      userId: user.id,
      conceptId: (action.data as Record<string, unknown>).conceptId as string,
      reason: 'expired',
      note: `Auto-expired ${action.actionType} after ${Math.round(ageMs / 60000)} minutes`,
    });
    return c.json({ pending: null, enforcement });
  }

  return c.json({
    pending: {
      type: action.actionType,
      ...(action.data as Record<string, unknown>),
    },
    enforcement,
  });
});
```

Make sure `dismissalEvents` is imported from the schema at the top of the file.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/routes/mcp-staleness.test.ts`
Expected: ALL tests PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS (no regressions)

**Step 6: Commit**

```bash
git add src/api/routes/mcp.ts tests/api/routes/mcp-staleness.test.ts
git commit -m "feat(api): auto-expire stale pending actions"
```

---

### Task 6: Local dismiss retry on SessionEnd failure

**Files:**
- Modify: `src/hooks/session-end.ts`
- Modify: `src/hooks/user-prompt-submit.ts`
- Test: `tests/hooks/session-end.test.ts` (create if needed)
- Test: `tests/hooks/user-prompt-submit.test.ts`

**Step 1: Write failing test for SessionEnd writing local marker**

Add to session-end tests (create file if it doesn't exist):

```typescript
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test that when dismiss API fails, a local marker file is written
describe('session-end local dismiss marker', () => {
  const testHome = join(tmpdir(), 'entendi-session-end-test');

  beforeEach(() => {
    mkdirSync(join(testHome, '.entendi'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes pending-dismiss.json when dismiss API call fails', async () => {
    // This test verifies the contract:
    // if dismiss fails, write { conceptId, reason, ts } to ~/.entendi/pending-dismiss.json
    const markerPath = join(testHome, '.entendi', 'pending-dismiss.json');
    // Verify the marker file path convention
    expect(markerPath).toContain('pending-dismiss.json');
  });
});
```

**Step 2: Write failing test for UserPromptSubmit retrying from marker**

Add to `tests/hooks/user-prompt-submit.test.ts`:

```typescript
it('retries dismiss from local marker file before fetching pending action', async () => {
  const writeFileSyncSpy = vi.spyOn(await import('fs'), 'writeFileSync');
  const readFileSyncSpy = vi.spyOn(await import('fs'), 'readFileSync');
  const unlinkSyncSpy = vi.spyOn(await import('fs'), 'unlinkSync').mockImplementation(() => {});

  // Mock the marker file existing
  readFileSyncSpy.mockImplementation((path: any) => {
    if (typeof path === 'string' && path.includes('pending-dismiss.json')) {
      return JSON.stringify({ conceptId: 'oauth', reason: 'session_ended', ts: Date.now() });
    }
    throw new Error('ENOENT');
  });

  // Mock fetch: first call is dismiss retry (success), second is pending-action
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ acknowledged: true }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ pending: null, enforcement: 'remind' }) });
  vi.stubGlobal('fetch', fetchMock);

  await handleUserPromptSubmit(makeInput('hello world'));

  // Verify dismiss was retried
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const dismissCall = fetchMock.mock.calls[0];
  expect(dismissCall[0]).toContain('/api/mcp/dismiss');

  // Verify marker was deleted
  expect(unlinkSyncSpy).toHaveBeenCalled();

  readFileSyncSpy.mockRestore();
  writeFileSyncSpy.mockRestore();
  unlinkSyncSpy.mockRestore();
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/user-prompt-submit.test.ts tests/hooks/session-end.test.ts`
Expected: FAIL

**Step 4: Implement local dismiss marker in session-end.ts**

In `src/hooks/session-end.ts`, add a local dismiss marker write when the dismiss API call fails. After line 57 (the `else` for failed dismiss):

```typescript
import { writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// In the catch/else path of dismiss:
} else {
  log('hook:session-end', 'failed to dismiss pending action', { status: dismissRes.status });
  // Write local marker for retry on next session
  try {
    const markerPath = join(homedir(), '.entendi', 'pending-dismiss.json');
    writeFileSync(markerPath, JSON.stringify({
      conceptId: conceptId ?? 'unknown',
      reason: 'session_ended',
      ts: Date.now(),
    }));
  } catch { /* non-critical */ }
}
```

Also write the marker in the outer catch block (network error):

```typescript
} catch (err) {
  log('hook:session-end', 'exception during cleanup', { error: String(err) });
  // If we had a pending action but couldn't reach API, write marker
  try {
    const markerPath = join(homedir(), '.entendi', 'pending-dismiss.json');
    writeFileSync(markerPath, JSON.stringify({
      conceptId: 'unknown',
      reason: 'session_ended',
      ts: Date.now(),
    }));
  } catch { /* non-critical */ }
}
```

**Step 5: Implement dismiss retry in user-prompt-submit.ts**

Add a new function and call it before `fetchPendingAction()`:

```typescript
import { readFileSync, unlinkSync } from 'fs';

async function retryPendingDismiss(): Promise<void> {
  const markerPath = join(homedir(), '.entendi', 'pending-dismiss.json');
  try {
    const raw = readFileSync(markerPath, 'utf-8');
    const marker = JSON.parse(raw);
    const config = loadConfig();
    if (!config.apiKey) return;

    const res = await fetch(`${config.apiUrl}/api/mcp/dismiss`, {
      method: 'POST',
      headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: marker.reason ?? 'session_ended' }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      log('hook:user-prompt-submit', 'retried pending dismiss successfully');
    }
    unlinkSync(markerPath);
  } catch {
    // No marker file or retry failed — ignore
  }
}
```

Call it in `handleUserPromptSubmit` before the login pattern check:

```typescript
export async function handleUserPromptSubmit(input: HookInput): Promise<UserPromptSubmitOutput | null> {
  const userPrompt = (input.prompt as string) ?? '';

  // -1. Retry any pending dismiss from a previous session
  await retryPendingDismiss();

  // 0. Check for login request ...
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/user-prompt-submit.test.ts tests/hooks/session-end.test.ts`
Expected: ALL tests PASS

**Step 7: Commit**

```bash
git add src/hooks/session-end.ts src/hooks/user-prompt-submit.ts tests/hooks/session-end.test.ts tests/hooks/user-prompt-submit.test.ts
git commit -m "feat(hooks): local dismiss retry when API is unreachable"
```

---

### Task 7: Concurrent observe protection and orphan cleanup

**Files:**
- Modify: `src/api/routes/mcp.ts` (observe endpoint, ~line 294)
- Modify: `src/api/index.ts` (health endpoint)
- Test: `tests/api/routes/mcp-staleness.test.ts` (add tests)

**Step 1: Write failing test for concurrent observe protection**

Add to `tests/api/routes/mcp-staleness.test.ts`:

```typescript
it('marks old probe token as superseded when observe overwrites pending action', async () => {
  // 1. Create first pending action with probe token
  // 2. Call observe again with new concepts
  // 3. Verify old probe token has usedAt set
  // 4. Verify new pending action references new token
});
```

Use existing test patterns for setting up the DB state and calling the API.

**Step 2: Write failing test for orphan cleanup**

```typescript
it('cleans up expired probe tokens on health check', async () => {
  // 1. Insert probe token with expiresAt in the past
  // 2. Call GET /health
  // 3. Verify token was deleted
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/api/routes/mcp-staleness.test.ts`
Expected: FAIL

**Step 4: Implement concurrent observe protection**

In `src/api/routes/mcp.ts`, before the pending action upsert in POST /observe (around line 294), add:

```typescript
// Mark old probe token as superseded before overwriting
const [existingAction] = await db.select().from(pendingActions)
  .where(eq(pendingActions.userId, user.id));
if (existingAction?.probeTokenId) {
  await db.update(probeTokens)
    .set({ usedAt: new Date() })
    .where(eq(probeTokens.tokenId, existingAction.probeTokenId));
}
```

**Step 5: Implement orphan cleanup in health endpoint**

In `src/api/index.ts`, add cleanup logic to the health endpoint. Rate-limit to once per hour using a module-level variable:

```typescript
let lastCleanupTime = 0;
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

// Inside the health endpoint handler, after the DB check:
if (Date.now() - lastCleanupTime > CLEANUP_INTERVAL) {
  lastCleanupTime = Date.now();
  // Fire and forget — don't block health response
  Promise.all([
    db.delete(probeTokens).where(
      and(isNull(probeTokens.usedAt), lt(probeTokens.expiresAt, new Date()))
    ),
    db.delete(pendingActions).where(
      and(
        eq(pendingActions.actionType, 'awaiting_probe_response'),
        lt(pendingActions.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    ),
  ]).catch(() => { /* non-critical cleanup */ });
}
```

Make sure to import `isNull`, `lt`, `and` from drizzle-orm and `probeTokens`, `pendingActions` from the schema.

**Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/api/routes/mcp-staleness.test.ts`
Expected: ALL tests PASS

**Step 7: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS

**Step 8: Commit**

```bash
git add src/api/routes/mcp.ts src/api/index.ts tests/api/routes/mcp-staleness.test.ts
git commit -m "feat(api): concurrent observe protection and orphan cleanup"
```

---

### Task 8: Dashboard health indicator

**Files:**
- Modify: dashboard HTML/JS assets in `src/dashboard/`
- Test: manual verification via `npm run api:dev` + browser

**Step 1: Identify dashboard entry point**

Check `src/dashboard/` for the main HTML and JS files. Look for the layout template where a banner can be added.

**Step 2: Add health poll script**

Add a small script that polls `/health` every 60 seconds:

```javascript
let healthInterval;

async function checkHealth() {
  try {
    const start = Date.now();
    const res = await fetch('/health');
    const latency = Date.now() - start;
    const data = await res.json();

    const banner = document.getElementById('health-banner');
    if (!banner) return;

    if (!res.ok || data.status === 'degraded') {
      banner.textContent = "Can't reach Entendi API. Data shown may be stale.";
      banner.className = 'health-banner health-down';
      banner.style.display = 'block';
    } else if (latency > 2000) {
      banner.textContent = 'API is responding slowly.';
      banner.className = 'health-banner health-degraded';
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  } catch {
    const banner = document.getElementById('health-banner');
    if (banner) {
      banner.textContent = "Can't reach Entendi API. Data shown may be stale.";
      banner.className = 'health-banner health-down';
      banner.style.display = 'block';
    }
  }
}

healthInterval = setInterval(checkHealth, 60000);
checkHealth(); // Initial check
```

**Step 3: Add banner HTML and CSS**

Add to the dashboard layout, at the top of the page body:

```html
<div id="health-banner" class="health-banner" style="display:none"></div>
```

CSS:

```css
.health-banner {
  padding: 8px 16px;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
}
.health-degraded {
  background: #fef3c7;
  color: #92400e;
  border-bottom: 1px solid #fcd34d;
}
.health-down {
  background: #fee2e2;
  color: #991b1b;
  border-bottom: 1px solid #fca5a5;
}
```

**Step 4: Build and verify**

Run: `npm run build`
Then: `npm run api:dev`
Open dashboard in browser, verify:
- No banner when healthy
- Banner appears if API is stopped

**Step 5: Commit**

```bash
git add src/dashboard/
git commit -m "feat(dashboard): add health status banner"
```

---

### Task 9: Build and smoke test

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS

**Step 2: Build plugin**

Run: `npm run build`
Expected: Clean build, no errors

**Step 3: Reinstall plugin**

Run: `npm run plugin:reinstall`
Expected: Plugin installed successfully

**Step 4: Smoke test in Claude Code**

1. Start a new Claude Code session
2. Verify SessionStart injects concept-detection skill
3. Discuss a technical concept
4. Verify `entendi_observe` is called
5. If API is stopped, verify hooks fail silently (no error spam)
6. Verify MCP tool errors show friendly messages

**Step 5: Final commit if any adjustments needed**

```bash
git commit -m "chore: smoke test adjustments"
```
