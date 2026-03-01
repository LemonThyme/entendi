# Observe Enforcement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure `entendi_observe` is called reliably every session turn via configurable enforcement levels (off/remind/enforce), using UserPromptSubmit reminders and Stop hook safety net.

**Architecture:** Hooks enforce observation — UserPromptSubmit injects a per-message reminder (~84% compliance), Stop hook catches misses by reading the transcript and blocking if needed (~100% combined). Enforcement level is resolved server-side (org metadata) and piggybacked on the existing pending-action API call.

**Tech Stack:** TypeScript, Vitest, Hono, Drizzle ORM, Claude Code hooks API

---

### Task 1: Enforcement Level Resolver

**Files:**
- Create: `src/api/lib/enforcement.ts`
- Test: `tests/api/lib/enforcement.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/api/lib/enforcement.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resolveEnforcementLevel } from '../../src/api/lib/enforcement.js';

describe('resolveEnforcementLevel', () => {
  it('returns "remind" as default when user has no org', async () => {
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }) }) } as any;
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('remind');
  });

  it('returns org-level enforcement from metadata', async () => {
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ metadata: JSON.stringify({ enforcementLevel: 'enforce' }) }]) }) }) }) } as any;
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('enforce');
  });

  it('returns "remind" when org metadata has no enforcementLevel', async () => {
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ metadata: JSON.stringify({ integritySettings: {} }) }]) }) }) }) } as any;
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('remind');
  });

  it('returns "off" when org sets enforcement to off', async () => {
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ metadata: JSON.stringify({ enforcementLevel: 'off' }) }]) }) }) }) } as any;
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('off');
  });

  it('picks strictest level when user belongs to multiple orgs', async () => {
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([
      { metadata: JSON.stringify({ enforcementLevel: 'remind' }) },
      { metadata: JSON.stringify({ enforcementLevel: 'enforce' }) },
    ]) }) }) }) } as any;
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('enforce');
  });

  it('ignores malformed metadata', async () => {
    const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ metadata: 'not-json' }]) }) }) }) } as any;
    const result = await resolveEnforcementLevel(db, 'user-123');
    expect(result).toBe('remind');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/lib/enforcement.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/api/lib/enforcement.ts
import { eq } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { member, organization } from '../db/schema.js';

export type EnforcementLevel = 'off' | 'remind' | 'enforce';

const STRICTNESS: Record<EnforcementLevel, number> = { off: 0, remind: 1, enforce: 2 };
const DEFAULT_LEVEL: EnforcementLevel = 'remind';

export async function resolveEnforcementLevel(db: Database, userId: string): Promise<EnforcementLevel> {
  const memberships = await db
    .select({ metadata: organization.metadata })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId));

  let effective: EnforcementLevel = DEFAULT_LEVEL;

  for (const row of memberships) {
    if (!row.metadata) continue;
    try {
      const parsed = JSON.parse(row.metadata);
      const level = parsed.enforcementLevel;
      if (level === 'off' || level === 'remind' || level === 'enforce') {
        if (STRICTNESS[level] > STRICTNESS[effective]) {
          effective = level;
        }
      }
    } catch {
      // ignore malformed metadata
    }
  }

  return effective;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/lib/enforcement.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(enforcement): add enforcement level resolver

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 2: Extend Pending-Action API to Return Enforcement Level

**Files:**
- Modify: `src/api/routes/mcp.ts:1044-1060` (GET /pending-action)
- Test: `tests/api/routes/mcp-enforcement.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/api/routes/mcp-enforcement.test.ts
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers.js';

// NOTE: This test needs the same test app setup pattern used in existing
// mcp route tests. Check tests/api/routes/ for the createTestApp helper.
// If no shared helper exists, follow the pattern from mcp-security.test.ts.

describe('GET /api/mcp/pending-action enforcement', () => {
  it('returns enforcement field in response', async () => {
    // Use existing test app setup pattern from the codebase
    // The response should include { pending: null, enforcement: "remind" }
  });
});
```

> **Note to implementer:** Check `tests/api/routes/mcp-security.test.ts` for the exact test app setup pattern (DB connection, auth, etc.). Mirror that pattern. The key assertion is that the response JSON includes an `enforcement` field.

**Step 2: Modify the GET /pending-action endpoint**

In `src/api/routes/mcp.ts`, find the `GET /pending-action` handler (line ~1044) and add enforcement resolution:

```typescript
// At the top of mcp.ts, add import:
import { resolveEnforcementLevel } from '../lib/enforcement.js';

// In the GET /pending-action handler, after fetching the pending action:
mcpRoutes.get('/pending-action', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const [action] = await db.select().from(pendingActions)
    .where(eq(pendingActions.userId, user.id));

  const enforcement = await resolveEnforcementLevel(db, user.id);

  if (!action) return c.json({ pending: null, enforcement });

  return c.json({
    pending: {
      type: action.actionType,
      ...(action.data as Record<string, unknown>),
    },
    enforcement,
  });
});
```

**Step 3: Run test to verify it passes**

Run: `npx vitest run tests/api/routes/mcp-enforcement.test.ts`
Expected: PASS

**Step 4: Run full test suite to check for regressions**

Run: `npm test`
Expected: All existing tests still pass. The `enforcement` field is additive — no breaking changes.

**Step 5: Commit**

```
feat(api): return enforcement level in pending-action response

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 3: UserPromptSubmit — Enforcement Caching and Observe Reminder

**Files:**
- Modify: `src/hooks/user-prompt-submit.ts`
- Modify: `tests/hooks/user-prompt-submit.test.ts`

**Step 1: Write the failing tests**

Add to `tests/hooks/user-prompt-submit.test.ts`:

```typescript
describe('observe reminder injection', () => {
  it('injects observe reminder when no pending action and enforcement is remind', async () => {
    mockPendingAction(null); // modify mockPendingAction to also return enforcement
    const result = await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));
    expect(result).toBeDefined();
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('entendi_observe');
    expect(ctx).toContain('MANDATORY');
  });

  it('does NOT inject reminder when enforcement is off', async () => {
    mockPendingActionWithEnforcement(null, 'off');
    const result = await handleUserPromptSubmit(makeInput('fix the OAuth redirect'));
    expect(result).toBeNull();
  });

  it('does NOT inject reminder when pending action exists', async () => {
    mockPendingActionWithEnforcement(
      { type: 'awaiting_probe_response', conceptId: 'oauth', depth: 1, timestamp: new Date().toISOString() },
      'enforce',
    );
    const result = await handleUserPromptSubmit(makeInput('oauth uses tokens'));
    const ctx = result!.hookSpecificOutput?.additionalContext!;
    expect(ctx).toContain('pending comprehension probe');
    expect(ctx).not.toContain('MANDATORY');
  });
});
```

> **Note to implementer:** Update `mockPendingAction` to also return `enforcement` field in the JSON response: `{ pending: action, enforcement: 'remind' }`. Create a `mockPendingActionWithEnforcement(action, level)` helper.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/user-prompt-submit.test.ts`
Expected: FAIL — new tests fail because reminder logic doesn't exist yet

**Step 3: Implement enforcement caching and reminder**

Modify `src/hooks/user-prompt-submit.ts`:

```typescript
import { writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// In fetchPendingAction, update return type to include enforcement:
async function fetchPendingAction(): Promise<{ pending: any | null; enforcement: string }> {
  // ... existing fetch logic ...
  const data = await res.json() as { pending: any | null; enforcement?: string };
  const enforcement = data.enforcement ?? 'remind';

  // Cache enforcement level for the Stop hook
  try {
    const cachePath = join(homedir(), '.entendi', 'enforcement-cache.json');
    writeFileSync(cachePath, JSON.stringify({ enforcement, ts: Date.now() }));
  } catch {
    // non-critical
  }

  return { pending: data.pending, enforcement };
}

// In handleUserPromptSubmit, after all existing checks return null:
export async function handleUserPromptSubmit(input: HookInput): Promise<UserPromptSubmitOutput | null> {
  // ... existing login detection ...

  const { pending, enforcement } = await fetchPendingAction();

  // ... existing pending action switch ...
  // ... existing teach-me detection ...

  // No pending action, no patterns — inject observe reminder if enforcement allows
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
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/user-prompt-submit.test.ts`
Expected: PASS (all existing + new tests)

**Step 5: Commit**

```
feat(hooks): add observe reminder and enforcement caching to UserPromptSubmit

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 4: Transcript Parsing Utility

**Files:**
- Create: `src/hooks/transcript.ts`
- Create: `tests/hooks/transcript.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/hooks/transcript.test.ts
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { findLastUserMessage, hasObserveCallInCurrentTurn } from '../../src/hooks/transcript.js';

function makeTempTranscript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'entendi-test-'));
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));
  return path;
}

describe('transcript parsing', () => {
  it('detects entendi_observe tool call in current turn', () => {
    const path = makeTempTranscript([
      { type: 'human', message: { content: 'fix the OAuth redirect' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } },
    ]);
    expect(hasObserveCallInCurrentTurn(path)).toBe(true);
  });

  it('returns false when no observe call exists', () => {
    const path = makeTempTranscript([
      { type: 'human', message: { content: 'fix the OAuth redirect' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done!' }] } },
    ]);
    expect(hasObserveCallInCurrentTurn(path)).toBe(false);
  });

  it('only checks current turn (after last user message)', () => {
    const path = makeTempTranscript([
      { type: 'human', message: { content: 'first message' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } },
      { type: 'human', message: { content: 'second message' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done!' }] } },
    ]);
    expect(hasObserveCallInCurrentTurn(path)).toBe(false);
  });

  it('extracts last user message text', () => {
    const path = makeTempTranscript([
      { type: 'human', message: { content: 'first message' } },
      { type: 'human', message: { content: 'fix the OAuth redirect issue' } },
    ]);
    expect(findLastUserMessage(path)).toBe('fix the OAuth redirect issue');
  });

  it('returns empty string for missing file', () => {
    expect(findLastUserMessage('/nonexistent/file.jsonl')).toBe('');
  });

  it('handles large transcripts by reading only tail', () => {
    // Create a transcript with many lines, verify it still works
    const lines = [];
    for (let i = 0; i < 500; i++) {
      lines.push({ type: 'human', message: { content: `message ${i}` } });
      lines.push({ type: 'assistant', message: { content: [{ type: 'text', text: `response ${i}` }] } });
    }
    lines.push({ type: 'human', message: { content: 'final message' } });
    lines.push({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } });
    const path = makeTempTranscript(lines);
    expect(hasObserveCallInCurrentTurn(path)).toBe(true);
    expect(findLastUserMessage(path)).toBe('final message');
  });
});
```

> **Note to implementer:** The exact JSONL format depends on how Claude Code writes transcripts. Check the actual transcript file at `~/.claude/projects/*/` to verify the structure. The test fixtures above are best-guess based on Claude Code's format — adjust field names after inspecting a real transcript.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/transcript.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/hooks/transcript.ts
import { openSync, readSync, fstatSync, closeSync, readFileSync } from 'fs';

const TAIL_BYTES = 50 * 1024; // Read last 50KB of transcript

function readTail(path: string): string {
  try {
    const fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(stat.size, TAIL_BYTES));
    readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);
    return buf.toString('utf-8');
  } catch {
    return '';
  }
}

function parseLines(raw: string): any[] {
  return raw.split('\n')
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

export function hasObserveCallInCurrentTurn(transcriptPath: string): boolean {
  const raw = readTail(transcriptPath);
  const lines = parseLines(raw);

  // Find the last user message index
  let lastUserIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].type === 'human') {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) return false;

  // Scan from last user message onward for observe calls
  for (let i = lastUserIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const content = line?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && typeof block.name === 'string' && block.name.includes('entendi_observe')) {
        return true;
      }
    }
  }

  return false;
}

export function findLastUserMessage(transcriptPath: string): string {
  const raw = readTail(transcriptPath);
  const lines = parseLines(raw);

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].type === 'human') {
      const content = lines[i].message?.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        const text = content.find((b: any) => b.type === 'text');
        return text?.text ?? '';
      }
    }
  }

  return '';
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/transcript.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(hooks): add transcript parsing for observe detection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 5: Trivial Message Detection Utility

**Files:**
- Create: `src/hooks/trivial.ts`
- Create: `tests/hooks/trivial.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/hooks/trivial.test.ts
import { describe, expect, it } from 'vitest';
import { isTrivialMessage } from '../../src/hooks/trivial.js';

describe('isTrivialMessage', () => {
  it.each([
    'yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank you',
    'do it', 'go ahead', 'sounds good', 'lgtm', 'ship it',
    'commit', 'push', 'deploy', 'Yes!', 'OK.', 'LGTM',
  ])('detects "%s" as trivial', (msg) => {
    expect(isTrivialMessage(msg)).toBe(true);
  });

  it.each([
    'fix the OAuth redirect issue',
    'use redis for caching',
    'why is my component re-rendering?',
    'add a websocket connection',
    'try using Thompson sampling',
    'set up CI with GitHub Actions',
  ])('detects "%s" as non-trivial', (msg) => {
    expect(isTrivialMessage(msg)).toBe(false);
  });

  it('treats messages under 15 chars as trivial', () => {
    expect(isTrivialMessage('hi')).toBe(true);
    expect(isTrivialMessage('do it now')).toBe(true);
  });

  it('treats empty string as trivial', () => {
    expect(isTrivialMessage('')).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/trivial.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/hooks/trivial.ts
const TRIVIAL_PATTERNS = [
  /^(yes|no|ok|okay|sure|yep|yup|nah|nope|thanks|thank you|ty|thx|do it|go ahead|sounds good|lgtm|ship it|commit|push|deploy|done|agreed|correct|right|exactly|perfect|great|nice|cool|awesome|got it|understood|continue|proceed)[\s.!?,]*$/i,
];

export function isTrivialMessage(msg: string): boolean {
  const trimmed = msg.trim();
  if (trimmed.length < 15) return true;
  return TRIVIAL_PATTERNS.some(p => p.test(trimmed));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/trivial.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(hooks): add trivial message detection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 6: Stop Hook — Observe Enforcement

**Files:**
- Modify: `src/hooks/stop.ts`
- Modify: `tests/hooks/stop.test.ts`

**Step 1: Write the failing tests**

Add to `tests/hooks/stop.test.ts`. These test the exported `handleStop` function directly (unit tests), not through the bash wrapper:

```typescript
// Add new imports at top:
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { handleStop, type StopOutput } from '../../src/hooks/stop.js';

function makeTempTranscript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'entendi-stop-'));
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));
  return path;
}

function writeEnforcementCache(homeDir: string, level: string) {
  writeFileSync(join(homeDir, '.entendi', 'enforcement-cache.json'), JSON.stringify({ enforcement: level, ts: Date.now() }));
}

describe('handleStop observe enforcement', () => {
  it('allows stop immediately when stop_hook_active is true', async () => {
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      stop_hook_active: true,
      transcript_path: '/nonexistent',
    });
    expect(result).toBeNull(); // null = allow stop
  });

  it('allows stop when enforcement is off', async () => {
    const home = makeTestHome('enforce-off');
    writeEnforcementCache(home, 'off');
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: '/nonexistent',
    }, home);
    expect(result).toBeNull();
  });

  it('allows stop when observe was called in current turn', async () => {
    const home = makeTestHome('observe-called');
    writeEnforcementCache(home, 'enforce');
    const transcript = makeTempTranscript([
      { type: 'human', message: { content: 'fix OAuth' } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__plugin_entendi_entendi__entendi_observe' }] } },
    ]);
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: transcript,
    }, home);
    expect(result).toBeNull();
  });

  it('blocks stop when observe was not called and enforcement is enforce', async () => {
    const home = makeTestHome('observe-missed-enforce');
    writeEnforcementCache(home, 'enforce');
    const transcript = makeTempTranscript([
      { type: 'human', message: { content: 'fix the OAuth redirect issue with Better Auth' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done!' }] } },
    ]);
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: transcript,
    }, home);
    expect(result).toBeDefined();
    expect(result!.decision).toBe('block');
    expect(result!.reason).toContain('entendi_observe');
  });

  it('allows stop (with log) when observe was not called and enforcement is remind', async () => {
    const home = makeTestHome('observe-missed-remind');
    writeEnforcementCache(home, 'remind');
    const transcript = makeTempTranscript([
      { type: 'human', message: { content: 'fix the OAuth redirect issue with Better Auth' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done!' }] } },
    ]);
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: transcript,
    }, home);
    expect(result).toBeNull(); // remind mode doesn't block
  });

  it('allows stop when message is trivial', async () => {
    const home = makeTestHome('trivial-msg');
    writeEnforcementCache(home, 'enforce');
    const transcript = makeTempTranscript([
      { type: 'human', message: { content: 'yes' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } },
    ]);
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: transcript,
    }, home);
    expect(result).toBeNull();
  });

  it('allows stop gracefully when transcript is missing', async () => {
    const home = makeTestHome('missing-transcript');
    writeEnforcementCache(home, 'enforce');
    const result = await handleStop({
      session_id: 'test', cwd: '/tmp', hook_event_name: 'Stop',
      transcript_path: '/nonexistent/file.jsonl',
    }, home);
    expect(result).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/stop.test.ts`
Expected: FAIL — `handleStop` doesn't exist / doesn't have enforcement logic

**Step 3: Implement observe enforcement in stop.ts**

Refactor `src/hooks/stop.ts` to export a testable `handleStop` function:

```typescript
// src/hooks/stop.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig } from '../shared/config.js';
import { hasObserveCallInCurrentTurn, findLastUserMessage } from './transcript.js';
import { isTrivialMessage } from './trivial.js';
import { log, readStdin, type HookInput } from './shared.js';

export interface StopInput extends HookInput {
  transcript_path?: string;
  stop_hook_active?: boolean;
}

export interface StopOutput {
  decision: 'block';
  reason: string;
}

function readEnforcementCache(homeDir?: string): string {
  try {
    const dir = homeDir ?? homedir();
    const raw = readFileSync(join(dir, '.entendi', 'enforcement-cache.json'), 'utf-8');
    const data = JSON.parse(raw);
    // Ignore stale cache (> 5 minutes old)
    if (Date.now() - data.ts > 5 * 60 * 1000) return 'remind';
    return data.enforcement ?? 'remind';
  } catch {
    return 'remind';
  }
}

export async function handleStop(input: StopInput, homeDir?: string): Promise<StopOutput | null> {
  // 1. Prevent infinite loops
  if (input.stop_hook_active) {
    log('hook:stop', 'stop_hook_active is true, allowing stop');
    return null;
  }

  // 2. Check enforcement level
  const enforcement = readEnforcementCache(homeDir);
  if (enforcement === 'off') {
    log('hook:stop', 'enforcement is off, allowing stop');
    return null;
  }

  // 3. Check transcript for observe call
  const transcriptPath = input.transcript_path;
  if (!transcriptPath) {
    log('hook:stop', 'no transcript_path, allowing stop');
    return null;
  }

  if (hasObserveCallInCurrentTurn(transcriptPath)) {
    log('hook:stop', 'observe was called this turn, allowing stop');
    return null;
  }

  // 4. Check if user message was trivial
  const userMessage = findLastUserMessage(transcriptPath);
  if (isTrivialMessage(userMessage)) {
    log('hook:stop', 'trivial message, skipping observe enforcement');
    return null;
  }

  // 5. Enforce or remind
  if (enforcement === 'enforce') {
    log('hook:stop', 'observe NOT called, blocking stop', { enforcement, userMessage: userMessage.slice(0, 100) });
    return {
      decision: 'block',
      reason:
        `[Entendi] You did not call entendi_observe this turn. Identify technical ` +
        `concepts from the user's message and your work, then call entendi_observe before finishing.`,
    };
  }

  // enforcement === 'remind'
  log('hook:stop', 'observe NOT called (remind mode, not blocking)', { userMessage: userMessage.slice(0, 100) });
  return null;
}

// Keep existing checkDanglingProbes function unchanged

async function main() {
  log('hook:stop', 'session ending');
  const raw = await readStdin();
  let input: StopInput = { session_id: '', cwd: '', hook_event_name: 'Stop' };
  try {
    input = JSON.parse(raw);
  } catch {
    /* invalid input */
  }

  // Observe enforcement check
  const result = await handleStop(input);
  if (result) {
    // Output blocking decision as JSON
    process.stdout.write(JSON.stringify(result));
    process.exitCode = 0;
    return;
  }

  // Existing dangling probe check
  await checkDanglingProbes();

  log('hook:stop', 'done');
  process.exitCode = 0;
}
```

> **Note to implementer:** Keep the existing `checkDanglingProbes()` function intact. The new `handleStop` runs first — if it blocks, we skip the dangling check (Claude will call observe, then stop again). If it doesn't block, we do the dangling check as before.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/stop.test.ts`
Expected: PASS (all old + new tests)

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```
feat(hooks): add observe enforcement to Stop hook

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 7: Build, Reinstall Plugin, and Smoke Test

**Files:**
- No code changes

**Step 1: Build the project**

Run: `npm run build`
Expected: Clean build, no errors

**Step 2: Reinstall the plugin**

Run: `npm run plugin:reinstall`
Expected: Plugin installed successfully

**Step 3: Verify the transcript format**

Before testing, inspect an actual transcript file to verify our parsing assumptions match reality:

Run: `ls ~/.claude/projects/-Users-tk-Documents-Personal-Lab-entendi/*.jsonl | head -1 | xargs head -5`

Compare the JSONL structure with what `transcript.ts` expects. If the format differs, update `transcript.ts` and its tests.

**Step 4: Manual smoke test**

1. Start a new Claude Code session in the entendi project
2. Send a technical message: "let's add rate limiting to the API"
3. Observe: Does the UserPromptSubmit reminder appear in the system context?
4. Check: Does Claude call `entendi_observe`?
5. If Claude doesn't call observe: Does the Stop hook block and force it?
6. Check `~/.entendi/debug.log` for enforcement-related log entries

**Step 5: Commit any format fixes**

If transcript format needed adjustment, commit those fixes.

---

### Task 8: Org Enforcement Settings API

**Files:**
- Modify: `src/api/routes/org.ts`
- Test: follow existing org route test patterns

**Step 1: Write the failing test**

Add tests for GET/PUT org enforcement level. Follow the pattern in existing org route tests.

Key assertions:
- `GET /api/org/enforcement` returns current level (default `"remind"`)
- `PUT /api/org/enforcement` with `{ level: "enforce" }` updates org metadata
- Non-owner cannot change enforcement level
- Invalid level returns 400

**Step 2: Implement the endpoints**

```typescript
// In src/api/routes/org.ts, add:

// GET /enforcement — get org enforcement level
orgRoutes.get('/enforcement', async (c) => {
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No organization found' }, 400);

  const db = c.get('db');
  const [org] = await db.select({ metadata: organization.metadata })
    .from(organization).where(eq(organization.id, orgId));

  let level = 'remind';
  try {
    const parsed = JSON.parse(org?.metadata ?? '{}');
    if (['off', 'remind', 'enforce'].includes(parsed.enforcementLevel)) {
      level = parsed.enforcementLevel;
    }
  } catch {}

  return c.json({ enforcementLevel: level });
});

// PUT /enforcement — update org enforcement level (owner/admin only)
orgRoutes.put('/enforcement', async (c) => {
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No organization found' }, 400);

  const body = await c.req.json();
  const level = body.enforcementLevel;
  if (!['off', 'remind', 'enforce'].includes(level)) {
    return c.json({ error: 'enforcementLevel must be off, remind, or enforce' }, 400);
  }

  const db = c.get('db');
  const [org] = await db.select({ metadata: organization.metadata })
    .from(organization).where(eq(organization.id, orgId));

  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(org?.metadata ?? '{}'); } catch {}
  metadata.enforcementLevel = level;

  await db.update(organization)
    .set({ metadata: JSON.stringify(metadata) })
    .where(eq(organization.id, orgId));

  return c.json({ enforcementLevel: level });
});
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```
feat(api): add org enforcement level GET/PUT endpoints

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

---

### Task 9: Deploy and Set Enforcement Level

**Files:**
- No code changes

**Step 1: Deploy to Cloudflare Workers**

Run: `npx wrangler deploy`
Expected: Successful deployment

**Step 2: Set enforcement level for your org**

Use the API to set your org to `enforce` mode:

```bash
curl -X PUT https://entendi-api.tomaskorenblit.workers.dev/api/org/enforcement \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"enforcementLevel": "enforce"}'
```

**Step 3: Verify enforcement in a new session**

Start a new Claude Code session and confirm:
1. UserPromptSubmit reminder appears on each message
2. If observe is skipped, Stop hook blocks and forces it
3. Check `~/.entendi/debug.log` for enforcement flow

**Step 4: Commit any final adjustments**

---

### Task 10: Full Test Suite Verification

**Files:**
- No code changes

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing 733 + new ~20 tests)

**Step 2: Verify no regressions in existing flows**

Specifically check:
- Pending action flow still works (probe → evaluate → tutor)
- Login detection still works
- Teach-me pattern still works
- Stop hook still checks for dangling probes

**Step 3: Final commit if needed**

```
test: verify observe enforcement with full test suite

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
