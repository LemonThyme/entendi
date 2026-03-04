# MCP Apps for Cursor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add MCP Apps support to Entendi so tools render interactive UI views inside Cursor (and any MCP Apps-compatible host).

**Architecture:** Three views (Status Dashboard, ZPD Frontier, Probe UI) are embedded as HTML template strings in the MCP server. Each view uses raw `postMessage` JSON-RPC to communicate with the host — no client-side SDK dependency. Tools declare `_meta.ui.resourceUri` pointing to `ui://entendi/*` resources. Progressive enhancement: hosts without MCP Apps support still get text-only results.

**Tech Stack:** `@modelcontextprotocol/sdk` (already installed — `registerTool` + `registerResource`), vanilla HTML/CSS/JS for views, zero new dependencies.

**Key References:**
- MCP Apps Spec: `specification/stable/2026-01-26/apps.mdx` in `modelcontextprotocol/ext-apps`
- SDK server API: `McpServer.registerTool(name, config, cb)` with `config._meta.ui.resourceUri`
- SDK resource API: `McpServer.registerResource(name, uri, { mimeType }, readCallback)`
- MIME type: `text/html;profile=mcp-app`
- URI scheme: `ui://`

**Security Note:** All views use safe DOM methods (textContent, createElement, setAttribute) instead of innerHTML to prevent XSS. Data from tool results is always text-content-escaped before rendering.

---

### Task 1: Create shared view runtime

The runtime is a ~70-line JS string shared by all views. It handles the `ui/initialize` handshake, tool result reception, server tool calls, auto-resize, and host theme application.

**Files:**
- Create: `src/mcp/views/runtime.ts`

**Step 1: Write the failing test**

File: `tests/mcp/views/runtime.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { getViewRuntime } from '../../../src/mcp/views/runtime.js';

describe('view runtime', () => {
  it('exports a non-empty JS string', () => {
    const js = getViewRuntime();
    expect(typeof js).toBe('string');
    expect(js.length).toBeGreaterThan(100);
  });

  it('contains ui/initialize request', () => {
    const js = getViewRuntime();
    expect(js).toContain('ui/initialize');
  });

  it('contains postMessage transport', () => {
    const js = getViewRuntime();
    expect(js).toContain('postMessage');
  });

  it('contains auto-resize observer', () => {
    const js = getViewRuntime();
    expect(js).toContain('ResizeObserver');
  });

  it('contains theme application', () => {
    const js = getViewRuntime();
    expect(js).toContain('--color-background-primary');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/views/runtime.test.ts`
Expected: FAIL — module not found

**Step 3: Write the runtime**

File: `src/mcp/views/runtime.ts`

The runtime exposes `window.EntendiApp` with methods: `init(name, onReady)`, `callTool(name, args)`, `onToolResult(fn)`, `getHostContext()`, `openLink(url)`, `sendNotification(method, params)`.

Key implementation details:
- JSON-RPC 2.0 over `postMessage` to `window.parent`
- Pending promise map for request/response correlation
- `ui/initialize` handshake with `protocolVersion: '2026-01-26'`
- Theme variables applied to `:root` via `style.setProperty`
- `ResizeObserver` on `documentElement` with 50ms debounce sending `ui/notifications/size-changed`
- Listens for `ui/notifications/tool-result`, `ui/notifications/tool-input`, `ui/notifications/host-context-changed`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/views/runtime.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/mcp/views/runtime.ts tests/mcp/views/runtime.test.ts
git commit -m "feat(mcp): add shared MCP Apps view runtime"
```

---

### Task 2: Create Status Dashboard view

Renders a visual mastery overview when `entendi_get_status` is called. Uses safe DOM construction (createElement/textContent) — no innerHTML.

**Files:**
- Create: `src/mcp/views/status.ts`

**Step 1: Write the failing test**

File: `tests/mcp/views/status.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { getStatusViewHtml } from '../../../src/mcp/views/status.js';

describe('status view HTML', () => {
  it('returns valid HTML document', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the shared runtime', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('EntendiApp');
    expect(html).toContain('ui/initialize');
  });

  it('contains mastery display elements', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('overall-mastery');
    expect(html).toContain('concept-list');
  });

  it('has host theme fallback variables', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('--color-background-primary');
    expect(html).toContain('--color-text-primary');
  });

  it('uses safe DOM construction', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('createElement');
    expect(html).toContain('textContent');
    expect(html).not.toContain('innerHTML');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/views/status.test.ts`
Expected: FAIL — module not found

**Step 3: Write the status view**

File: `src/mcp/views/status.ts`

The view shows:
- **Overall mastery ring** — SVG donut chart with percentage
- **Stats row** — strong/growing/weak counts
- **Concept list** — sorted weakest-first, each with name, mastery bar, and badge (Strong/Growing/Weak)

Key implementation details:
- `pMastery(mu)` sigmoid: `1 / (1 + Math.exp(-mu / 0.5))`
- Color scale: green >= 70%, orange >= 40%, red < 40%
- SVG ring via `createElementNS('http://www.w3.org/2000/svg', ...)`
- All DOM built with `createElement`/`textContent`/`setAttribute` — never innerHTML
- On init: calls `entendi_get_status` via `EntendiApp.callTool`, parses JSON text content
- Also listens for `onToolResult` for when host pushes the result
- CSS uses host theme variables with fallback to Entendi's warm palette
- `color-scheme: light dark` for automatic theme support

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/views/status.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/mcp/views/status.ts tests/mcp/views/status.test.ts
git commit -m "feat(mcp): add Status Dashboard MCP App view"
```

---

### Task 3: Create ZPD Frontier view

Renders a visual learning path when `entendi_get_zpd_frontier` is called.

**Files:**
- Create: `src/mcp/views/frontier.ts`

**Step 1: Write the failing test**

File: `tests/mcp/views/frontier.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { getFrontierViewHtml } from '../../../src/mcp/views/frontier.js';

describe('frontier view HTML', () => {
  it('returns valid HTML document', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the shared runtime', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('EntendiApp');
  });

  it('contains frontier display elements', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('frontier-list');
  });

  it('has Start Learning interaction', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('entendi_start_tutor');
  });

  it('uses safe DOM construction', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('createElement');
    expect(html).not.toContain('innerHTML');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/views/frontier.test.ts`
Expected: FAIL — module not found

**Step 3: Write the frontier view**

File: `src/mcp/views/frontier.ts`

The view shows:
- **Header** — "Learning Frontier" with subtitle
- **Frontier cards** — each concept with name, importance tag, readiness percentage, and "Start Learning" button
- Sorted by readiness score descending

Key implementation details:
- All DOM via `createElement`/`textContent` — no innerHTML
- "Start Learning" button calls `EntendiApp.callTool('entendi_start_tutor', { conceptId })`
- Button shows loading state while call is in flight
- Empty state when no frontier concepts available
- Same CSS variable system as status view

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/views/frontier.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/mcp/views/frontier.ts tests/mcp/views/frontier.test.ts
git commit -m "feat(mcp): add ZPD Frontier MCP App view"
```

---

### Task 4: Create Probe UI view

Renders an interactive probe card when `entendi_observe` returns `shouldProbe: true`. Shows minimal confirmation when no probe needed.

**Files:**
- Create: `src/mcp/views/probe.ts`

**Step 1: Write the failing test**

File: `tests/mcp/views/probe.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { getProbeViewHtml } from '../../../src/mcp/views/probe.js';

describe('probe view HTML', () => {
  it('returns valid HTML document', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the shared runtime', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('EntendiApp');
  });

  it('contains probe question area', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('probe-question');
  });

  it('contains answer input', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('probe-answer');
  });

  it('contains dismiss interaction', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('entendi_dismiss');
  });

  it('handles no-probe state', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('no-probe');
  });

  it('uses safe DOM construction', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('createElement');
    expect(html).not.toContain('innerHTML');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/views/probe.test.ts`
Expected: FAIL — module not found

**Step 3: Write the probe view**

File: `src/mcp/views/probe.ts`

Two states:
1. **No probe** — minimal "N concepts observed" card with checkmark
2. **Probe active** — full card with concept name, question, textarea, Submit + Skip buttons

Key implementation details:
- All DOM via `createElement`/`textContent` — no innerHTML
- Accent-colored left border on probe card for visual distinction
- Textarea auto-focuses, Submit button disabled until text entered
- Submit sends `ui/message` notification with response text (LLM handles evaluation)
- Skip calls `EntendiApp.callTool('entendi_dismiss', { reason: 'busy', note: 'Skipped via MCP App UI' })`
- After submit: shows feedback message, disables inputs
- 3-second timeout: if no tool result arrives, shows no-probe state (handles race conditions)

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/views/probe.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/mcp/views/probe.ts tests/mcp/views/probe.test.ts
git commit -m "feat(mcp): add Probe UI MCP App view"
```

---

### Task 5: Register MCP App resources and add UI metadata to tools

Modify `src/mcp/server.ts` to register `ui://` resources and add `_meta.ui.resourceUri` to the three tools.

**Files:**
- Modify: `src/mcp/server.ts`

**Step 1: Write the failing test**

File: `tests/mcp/views/registration.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createEntendiServer } from '../../../src/mcp/server.js';

describe('MCP App resource registration', () => {
  let server: ReturnType<typeof createEntendiServer>;

  beforeEach(() => {
    server = createEntendiServer({
      apiUrl: 'http://localhost:3456',
      apiKey: 'test-key',
    });
  });

  it('registers entendi_get_status tool', () => {
    const tools = server.getRegisteredTools();
    expect(tools.some(t => t.name === 'entendi_get_status')).toBe(true);
  });

  it('registers entendi_get_zpd_frontier tool', () => {
    const tools = server.getRegisteredTools();
    expect(tools.some(t => t.name === 'entendi_get_zpd_frontier')).toBe(true);
  });

  it('registers entendi_observe tool', () => {
    const tools = server.getRegisteredTools();
    expect(tools.some(t => t.name === 'entendi_observe')).toBe(true);
  });
});
```

Note: We cannot easily verify `_meta` or resource registration from the outside without reaching into MCP SDK internals. The test confirms the tools are registered. Manual testing in Cursor verifies the UI rendering.

**Step 2: Run test to verify current behavior**

Run: `npx vitest run tests/mcp/views/registration.test.ts`
Expected: PASS (tools are already registered)

**Step 3: Modify server.ts**

Add imports at top of `src/mcp/server.ts`:

```ts
import { getStatusViewHtml } from './views/status.js';
import { getFrontierViewHtml } from './views/frontier.js';
import { getProbeViewHtml } from './views/probe.js';
```

Inside the `if (authenticated)` block, before tool registrations, add resource registrations:

```ts
  // --- MCP App Resources (UI views for MCP Apps-compatible hosts) ---
  const APP_MIME = 'text/html;profile=mcp-app';

  mcpServer.resource(
    'Entendi Status Dashboard',
    'ui://entendi/status',
    { mimeType: APP_MIME, description: 'Interactive mastery dashboard' },
    async () => ({
      contents: [{ uri: 'ui://entendi/status', mimeType: APP_MIME, text: getStatusViewHtml() }],
    }),
  );

  mcpServer.resource(
    'Entendi ZPD Frontier',
    'ui://entendi/frontier',
    { mimeType: APP_MIME, description: 'Visual learning frontier' },
    async () => ({
      contents: [{ uri: 'ui://entendi/frontier', mimeType: APP_MIME, text: getFrontierViewHtml() }],
    }),
  );

  mcpServer.resource(
    'Entendi Probe',
    'ui://entendi/probe',
    { mimeType: APP_MIME, description: 'Interactive comprehension probe' },
    async () => ({
      contents: [{ uri: 'ui://entendi/probe', mimeType: APP_MIME, text: getProbeViewHtml() }],
    }),
  );
```

Then convert the three tool registrations from `mcpServer.tool(name, description, schema, handler)` to `mcpServer.registerTool(name, config, handler)` to add `_meta.ui`:

**For `entendi_get_status`:**

```ts
  mcpServer.registerTool(
    'entendi_get_status',
    {
      description: 'Get mastery status for all concepts or a specific concept.',
      inputSchema: {
        conceptId: z.preprocess(
          (v) => (v === '' || v === null ? undefined : v),
          z.string().optional(),
        ),
      },
      _meta: {
        ui: { resourceUri: 'ui://entendi/status' },
        'ui/resourceUri': 'ui://entendi/status',
      },
    },
    async (args, extra) => {
      // ... existing handler body (unchanged) ...
    },
  );
```

**For `entendi_get_zpd_frontier`:**

```ts
  mcpServer.registerTool(
    'entendi_get_zpd_frontier',
    {
      description: "Get concepts at the edge of the user's knowledge — ready to learn next.",
      inputSchema: {
        limit: z.preprocess(/* existing */),
        domain: z.preprocess(/* existing */),
        includeUnassessed: z.preprocess(/* existing */),
      },
      _meta: {
        ui: { resourceUri: 'ui://entendi/frontier' },
        'ui/resourceUri': 'ui://entendi/frontier',
      },
    },
    async (args, extra) => {
      // ... existing handler body (unchanged) ...
    },
  );
```

**For `entendi_observe`:**

```ts
  mcpServer.registerTool(
    'entendi_observe',
    {
      description: 'Observe concepts detected after a tool use. Determines if a comprehension probe is appropriate.',
      inputSchema: {
        concepts: z.preprocess(/* existing */),
        triggerContext: z.string(),
        primaryConceptId: z.preprocess(/* existing */),
        repoUrl: z.preprocess(/* existing */),
      },
      _meta: {
        ui: { resourceUri: 'ui://entendi/probe' },
        'ui/resourceUri': 'ui://entendi/probe',
      },
    },
    async (args, extra) => {
      // ... existing handler body (unchanged) ...
    },
  );
```

**Important:** Keep the `registeredTools.push({ name })` calls for each tool. Keep all handler bodies exactly as they are — the text content returned is the fallback for hosts without MCP Apps support.

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

**Step 5: Commit**

```bash
git add src/mcp/server.ts tests/mcp/views/registration.test.ts
git commit -m "feat(mcp): register MCP App views and add UI metadata to tools"
```

---

### Task 6: Update esbuild config to include views in plugin

The view files are imported by `server.ts`, so esbuild bundles them automatically into `dist/mcp/server.js`. No config changes needed for the MCP bundle.

**Step 1: Build and verify**

Run: `npm run build`
Expected: Build succeeds, `dist/mcp/server.js` includes the view HTML strings.

Verify:

```bash
grep -c "ui://entendi" dist/mcp/server.js
# Expected: 6+ (resource URIs + meta references)

grep -c "EntendiApp" dist/mcp/server.js
# Expected: 3+ (one per view)

grep -c "ui://entendi" dist/plugin/mcp/server.js
# Expected: same as above

grep -c "ui://entendi" plugin/mcp/server.js
# Expected: same as above
```

**Step 2: Commit** (only if build config changes were needed)

---

### Task 7: Add Cursor MCP configuration

Create a `.cursor/mcp.json` so the Entendi MCP server works in Cursor when opening the repo.

**Files:**
- Create: `.cursor/mcp.json`

**Step 1: Create the config**

File: `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "entendi": {
      "command": "node",
      "args": ["plugin/mcp/server.js"]
    }
  }
}
```

The MCP server reads its API key from `~/.entendi/config.json` (set by `entendi_login`), so no env vars needed.

**Step 2: Commit**

```bash
git add .cursor/mcp.json
git commit -m "feat(cursor): add MCP server configuration for Cursor"
```

---

### Task 8: Manual integration test in Cursor

**Step 1: Build**

```bash
npm run build
```

**Step 2: Open Cursor, verify MCP connects**

Check `~/.entendi/debug.log` for connection.

**Step 3: Test each view**

- "Show my Entendi mastery status" → Status Dashboard renders inline
- "What should I learn next?" → ZPD Frontier renders with cards
- Work with code → observe fires → Probe UI renders (or minimal acknowledgment)
- Test in Claude Code too → verify text-only fallback works

**Step 4: Commit any fixes**

```bash
git commit -m "fix(mcp): address integration test findings"
```

---

### Task 9: Update documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add Cursor section**

After "Key Commands", add:

```markdown
## Cursor Support

Entendi works as an MCP App in Cursor 2.6+, rendering interactive views inline in chat.

### Setup

Add to `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global):

\`\`\`json
{
  "mcpServers": {
    "entendi": {
      "command": "node",
      "args": ["<path-to>/plugin/mcp/server.js"]
    }
  }
}
\`\`\`

### Views

- **Status Dashboard** — mastery overview with concept bars and progress ring
- **ZPD Frontier** — learning recommendations with "Start Learning" buttons
- **Probe UI** — interactive comprehension probes with answer input

Views render automatically when the corresponding tools are called. Hosts without MCP Apps support get text-only fallback.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Cursor MCP Apps support documentation"
```
