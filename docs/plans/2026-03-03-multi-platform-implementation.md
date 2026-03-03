# Multi-Platform Entendi — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Entendi on Cursor and Codex with parity to Claude Code, via remote MCP endpoint + CLI installer + cross-platform skill.

**Architecture:** Three-tier progressive enhancement. Tier 1: Remote MCP on existing Cloudflare Worker (Streamable HTTP). Tier 2: `npx entendi init` CLI that auto-detects platforms and writes config/rules/skills. Tier 3: Existing Claude Code plugin (unchanged).

**Tech Stack:** `@modelcontextprotocol/sdk` (WebStandardStreamableHTTPServerTransport), Hono, esbuild, `add-mcp` patterns

---

### Task 1: Remote MCP Endpoint — Server Setup

**Files:**
- Create: `src/api/routes/mcp-remote.ts`
- Modify: `src/api/index.ts` (register route)

**Step 1: Write the failing test**

Create `tests/api/routes/mcp-remote.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createTestApp } from '../../helpers/app.js';

describe('Remote MCP endpoint', () => {
  it('POST /mcp returns JSON-RPC response for initialize', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBeDefined();
    expect(body.result.serverInfo.name).toBe('entendi');
  });

  it('POST /mcp rejects unauthenticated tools/call', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'entendi_get_status', arguments: {} },
      }),
    });
    // Should get error since not authenticated
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error || body.result?.isError).toBeTruthy();
  });

  it('GET /mcp returns 405 without session', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/mcp', { method: 'GET' });
    // Stateless mode rejects GET SSE streams
    expect([400, 405]).toContain(res.status);
  });

  it('DELETE /mcp returns 405 in stateless mode', async () => {
    const { app } = await createTestApp();
    const res = await app.request('/mcp', { method: 'DELETE' });
    expect([400, 405]).toContain(res.status);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/routes/mcp-remote.test.ts`
Expected: FAIL — route doesn't exist yet

**Step 3: Create the remote MCP route**

Create `src/api/routes/mcp-remote.ts`. This registers MCP tool handlers that proxy to the existing API routes (reusing the same logic as the stdio server but running in-process on the Worker):

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../index.js';

export const mcpRemoteRoutes = new Hono<Env>();

// Create a shared MCP server instance with tool definitions
function createMcpServerInstance(): McpServer {
  const server = new McpServer(
    { name: 'entendi', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  // Register tools that will be connected to API routes when handling requests
  // Tools registered here are "stubs" — actual logic is wired per-request
  // because each request needs its own auth context

  return server;
}

// Stateless transport: new transport per request, no session tracking
mcpRemoteRoutes.all('/', async (c) => {
  const server = createMcpServerInstance();

  // Wire tools to the authenticated user's context
  const user = c.get('user');
  const db = c.get('db');

  // Register all 9 tools with their handlers bound to this request's context
  registerTools(server, c);

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true, // Simpler for stateless: JSON instead of SSE
  });

  await server.connect(transport);
  const response = await transport.handleRequest(c.req.raw);
  await server.close();

  return response;
});

function registerTools(server: McpServer, c: any) {
  // entendi_observe
  server.tool('entendi_observe', 'Report detected concepts and get probe decision', {
    concepts: z.array(z.object({
      id: z.string(),
      name: z.string().optional(),
      source: z.enum(['llm', 'hook', 'manual']).optional(),
    })),
    triggerContext: z.string().optional(),
    primaryConceptId: z.string().optional(),
    repoUrl: z.preprocess(v => (v === '' || v === null ? undefined : v), z.string().url().max(500).optional()),
  }, async (args) => {
    // Proxy to internal API logic
    const res = await c.get('app').request('/api/mcp/observe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': c.req.header('Authorization') || '',
        'x-api-key': c.req.header('x-api-key') || '',
        'Cookie': c.req.header('Cookie') || '',
      },
      body: JSON.stringify(args),
    });
    const data = await res.json();
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
  });

  // Add remaining tools following same pattern...
  // (entendi_record_evaluation, entendi_start_tutor, etc.)
}
```

Note: The full implementation will register all 9 tools. The approach here is to create a new MCP server per request (stateless) and proxy tool calls to the existing internal API routes, preserving auth context.

**Step 4: Register the route in index.ts**

In `src/api/index.ts`, add:
```typescript
import { mcpRemoteRoutes } from './routes/mcp-remote.js';
// ... after other route registrations:
app.route('/mcp', mcpRemoteRoutes);
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api/routes/mcp-remote.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/api/routes/mcp-remote.ts src/api/index.ts tests/api/routes/mcp-remote.test.ts
git commit -m "feat: add remote MCP endpoint via Streamable HTTP"
```

---

### Task 2: Remote MCP — Wire All 9 Tool Handlers

**Files:**
- Modify: `src/api/routes/mcp-remote.ts`
- Test: `tests/api/routes/mcp-remote.test.ts`

**Step 1: Write failing tests for authenticated tool calls**

Add to test file:
```typescript
it('tools/list returns all 9 tools', async () => {
  // This test calls initialize then tools/list
  const { app, apiKey } = await createAuthenticatedTestApp();
  // initialize first
  await app.request('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    }),
  });
  // list tools
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const body = await res.json();
  expect(body.result.tools).toHaveLength(9);
  const names = body.result.tools.map((t: any) => t.name);
  expect(names).toContain('entendi_observe');
  expect(names).toContain('entendi_login');
  expect(names).toContain('entendi_health_check');
});
```

**Step 2: Run test — should fail (tools not all wired)**

**Step 3: Implement all 9 tool handlers**

Complete `registerTools()` in `src/api/routes/mcp-remote.ts` with all tools:
- `entendi_observe` → POST `/api/mcp/observe`
- `entendi_record_evaluation` → POST `/api/mcp/record-evaluation`
- `entendi_start_tutor` → POST `/api/mcp/tutor/start`
- `entendi_advance_tutor` → POST `/api/mcp/tutor/advance`
- `entendi_dismiss` → POST `/api/mcp/dismiss`
- `entendi_get_status` → GET `/api/mcp/status`
- `entendi_get_zpd_frontier` → GET `/api/mcp/zpd-frontier`
- `entendi_login` → Returns device-code URL (simplified for remote)
- `entendi_health_check` → GET `/health`

Use internal `app.request()` to proxy to existing routes, forwarding auth headers.

**Step 4: Run tests — PASS**

**Step 5: Commit**

```bash
git commit -m "feat: wire all 9 MCP tools to remote endpoint"
```

---

### Task 3: Remote MCP — Auth via API Key Header

**Files:**
- Modify: `src/api/routes/mcp-remote.ts`
- Test: `tests/api/routes/mcp-remote.test.ts`

The remote MCP endpoint needs to accept authentication. For the initial version, support API key via `Authorization: Bearer <key>` header (matching what MCP clients send). Better Auth already handles this via the session middleware in `index.ts`.

**Step 1: Write test for authenticated observe call**

```typescript
it('authenticated observe call returns shouldProbe decision', async () => {
  const { app, apiKey, userId } = await createAuthenticatedTestApp();
  // Call observe via MCP
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'entendi_observe',
        arguments: {
          concepts: [{ id: 'test-concept', name: 'Test Concept', source: 'llm' }],
        },
      },
    }),
  });
  const body = await res.json();
  expect(body.result).toBeDefined();
  // Tool result should contain shouldProbe
  const content = JSON.parse(body.result.content[0].text);
  expect(content).toHaveProperty('shouldProbe');
});
```

**Step 2: Run test — FAIL**

**Step 3: Ensure auth forwarding works in the proxy**

The key is that when the MCP transport handles the request, the auth headers from the original HTTP request must be forwarded to internal `app.request()` calls. Update the proxy to pass through auth context.

**Step 4: Run test — PASS**

**Step 5: Commit**

```bash
git commit -m "feat: remote MCP auth via API key and bearer token"
```

---

### Task 4: Remote MCP — Deploy and Smoke Test

**Files:**
- Modify: `src/api/worker.ts` (if needed for env propagation)

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (930+ existing + new remote MCP tests)

**Step 2: Build**

Run: `npm run build`
Expected: Clean build

**Step 3: Deploy**

Run: `npx wrangler deploy`

**Step 4: Smoke test remote MCP**

```bash
# Initialize
curl -X POST https://api.entendi.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'

# List tools (with API key)
curl -X POST https://api.entendi.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: YOUR_KEY' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

**Step 5: Commit**

```bash
git commit -m "feat: deploy remote MCP endpoint to production"
```

---

### Task 5: Cross-Platform Concept Detection Skill (SKILL.md)

**Files:**
- Create: `src/cli/templates/skill/SKILL.md`
- Create: `src/cli/templates/skill/references/probe-rubric.md`

**Step 1: Create cross-platform SKILL.md**

Adapt `plugin/skills/concept-detection/SKILL.md` for the Agent Skills open standard (agentskills.io). Remove Claude Code-specific references (hook names, plugin system), keep the core behavior.

```markdown
---
name: entendi-concept-detection
description: >
  Proactive concept detection for comprehension probing. Identifies technical
  concepts the user discusses and calls entendi_observe MCP tool to trigger
  understanding checks. Always active during technical discussions.
---

# Entendi: Concept Detection

You MUST call `entendi_observe` before finishing every response that involves
technical concepts. This is mandatory, not optional.

[... adapted instructions from current SKILL.md ...]
[Remove: Claude Code hook references, UserPromptSubmit mentions]
[Keep: observe rules, probe classification, scoring rubric, formatting]
[Add: "If you have access to entendi_get_status, check for pending probes"]
```

**Step 2: Create probe-rubric.md reference**

```markdown
# Probe Evaluation Rubric

- Score 0: No meaningful response, refusal, or completely wrong
- Score 1: Vague or partially correct; no specific technical details
- Score 2: Correct with specific details (mechanisms, tradeoffs, examples)
- Score 3: Deep understanding (nuances, edge cases, broader connections)
```

**Step 3: Verify skill is valid per agentskills.io spec**

- `name` field: lowercase + hyphens only, max 64 chars ✓
- `description` field: max 1024 chars ✓
- Body under 500 lines ✓

**Step 4: Commit**

```bash
git add src/cli/templates/
git commit -m "feat: create cross-platform concept-detection skill (Agent Skills standard)"
```

---

### Task 6: Cursor Rule Template

**Files:**
- Create: `src/cli/templates/cursor-rule.mdc`

**Step 1: Create the Cursor always-apply rule**

```markdown
---
description: "Entendi comprehension tracking — observe concepts in every technical response"
alwaysApply: true
---

# Entendi — Concept Detection

Before finishing any response involving technical concepts, you MUST call the
`entendi_observe` MCP tool with detected concepts.

## When to observe
- User discusses, asks about, or makes decisions involving a technical concept
- User is learning something new or working with unfamiliar technology

## How to observe
Call `entendi_observe` with:
- `concepts`: array of `{ id: "kebab-case-id", name: "Human Name", source: "llm" }`
- `primaryConceptId`: the concept the user is MOST DIRECTLY discussing
- Only pass explicitly mentioned concepts, not inferred/related ones

## When entendi_observe returns shouldProbe: true
Format the probe as:
```
🧠 Entendi — {Concept Name}
───────────────────────────────────────
{probe question}
───────────────────────────────────────
```

## Scoring user responses (0-3)
- 0: No meaningful response or completely wrong
- 1: Vague, no specific technical details
- 2: Correct with specific details
- 3: Deep understanding with nuances

Call `entendi_record_evaluation` with the score and the `probeToken` from observe.

## Dismissals
- User says "skip"/"I know this" → `entendi_dismiss` reason: `claimed_expertise`
- User says "not now"/"later" → `entendi_dismiss` reason: `busy`
- User ignores probe entirely → `entendi_dismiss` reason: `topic_change`
```

Keep under ~400 tokens for the alwaysApply rule.

**Step 2: Commit**

```bash
git add src/cli/templates/cursor-rule.mdc
git commit -m "feat: add Cursor always-apply rule template for concept detection"
```

---

### Task 7: Codex AGENTS.md Snippet Template

**Files:**
- Create: `src/cli/templates/codex-agents-snippet.md`

**Step 1: Create the AGENTS.md snippet**

```markdown
## Entendi — Comprehension Tracking

Before finishing any response involving technical concepts, call the `entendi_observe`
MCP tool with detected concepts (kebab-case IDs, source: "llm"). If it returns
`shouldProbe: true`, append the probe question using the 🧠 Entendi format.

Score user responses 0-3 via `entendi_record_evaluation` with the probeToken.
If user says "skip" → `entendi_dismiss` reason: claimed_expertise.
If user says "later" → `entendi_dismiss` reason: busy.
```

**Step 2: Commit**

```bash
git add src/cli/templates/codex-agents-snippet.md
git commit -m "feat: add Codex AGENTS.md snippet template"
```

---

### Task 8: CLI Installer — Platform Detection

**Files:**
- Create: `src/cli/init.ts`
- Create: `src/cli/platforms/detect.ts`
- Modify: `package.json` (add `bin` field)
- Modify: `esbuild.config.ts` (add CLI bundle)

**Step 1: Write test for platform detection**

Create `tests/cli/detect.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { detectPlatforms } from '../../src/cli/platforms/detect.js';
import * as fs from 'node:fs';

vi.mock('node:fs');

describe('detectPlatforms', () => {
  it('detects Cursor when .cursor/ exists', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).includes('.cursor')
    );
    const result = detectPlatforms('/project');
    expect(result).toContain('cursor');
  });

  it('detects Codex when .codex/ exists', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).includes('.codex')
    );
    const result = detectPlatforms('/project');
    expect(result).toContain('codex');
  });

  it('detects Claude Code when .claude/ exists in home', () => {
    vi.mocked(fs.existsSync).mockImplementation((p: any) =>
      String(p).includes('.claude')
    );
    const result = detectPlatforms('/project');
    expect(result).toContain('claude-code');
  });

  it('returns empty array when no platform detected', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = detectPlatforms('/project');
    expect(result).toEqual([]);
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement platform detection**

Create `src/cli/platforms/detect.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export type Platform = 'claude-code' | 'cursor' | 'codex' | 'vscode' | 'opencode';

const HOME = os.homedir();

const DETECTION_RULES: Array<{ platform: Platform; checks: string[] }> = [
  {
    platform: 'claude-code',
    checks: [
      path.join(HOME, '.claude'),
      '.mcp.json',
    ],
  },
  {
    platform: 'cursor',
    checks: [
      '.cursor',
      path.join(HOME, '.cursor'),
    ],
  },
  {
    platform: 'codex',
    checks: [
      '.codex',
      path.join(HOME, '.codex'),
    ],
  },
  {
    platform: 'vscode',
    checks: [
      '.vscode',
    ],
  },
  {
    platform: 'opencode',
    checks: [
      'opencode.json',
      path.join(HOME, '.config', 'opencode'),
    ],
  },
];

export function detectPlatforms(projectDir: string): Platform[] {
  const detected: Platform[] = [];

  for (const rule of DETECTION_RULES) {
    const found = rule.checks.some((check) => {
      const fullPath = path.isAbsolute(check) ? check : path.join(projectDir, check);
      return fs.existsSync(fullPath);
    });
    if (found) detected.push(rule.platform);
  }

  return detected;
}
```

**Step 4: Run test — PASS**

**Step 5: Commit**

```bash
git add src/cli/platforms/detect.ts tests/cli/detect.test.ts
git commit -m "feat: platform detection for CLI installer"
```

---

### Task 9: CLI Installer — Cursor Config Writer

**Files:**
- Create: `src/cli/platforms/cursor.ts`
- Test: `tests/cli/cursor.test.ts`

**Step 1: Write test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureCursor } from '../../src/cli/platforms/cursor.js';
import * as fs from 'node:fs';

vi.mock('node:fs');

describe('configureCursor', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  it('writes .cursor/mcp.json with entendi server', () => {
    configureCursor('/project', { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });
    const calls = vi.mocked(fs.writeFileSync).mock.calls;
    const mcpCall = calls.find(c => String(c[0]).includes('mcp.json'));
    expect(mcpCall).toBeDefined();
    const config = JSON.parse(String(mcpCall![1]));
    expect(config.mcpServers.entendi).toBeDefined();
  });

  it('writes .cursor/rules/entendi.mdc', () => {
    configureCursor('/project', { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });
    const calls = vi.mocked(fs.writeFileSync).mock.calls;
    const ruleCall = calls.find(c => String(c[0]).includes('entendi.mdc'));
    expect(ruleCall).toBeDefined();
    expect(String(ruleCall![1])).toContain('alwaysApply: true');
  });

  it('preserves existing MCP servers in config', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      mcpServers: { other: { command: 'test' } }
    }));
    configureCursor('/project', { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });
    const calls = vi.mocked(fs.writeFileSync).mock.calls;
    const mcpCall = calls.find(c => String(c[0]).includes('mcp.json'));
    const config = JSON.parse(String(mcpCall![1]));
    expect(config.mcpServers.other).toBeDefined();
    expect(config.mcpServers.entendi).toBeDefined();
  });
});
```

**Step 2: Run test — FAIL**

**Step 3: Implement Cursor config writer**

Create `src/cli/platforms/cursor.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

interface ConfigOptions {
  apiKey: string;
  apiUrl: string;
}

export function configureCursor(projectDir: string, opts: ConfigOptions): void {
  const cursorDir = path.join(projectDir, '.cursor');
  const rulesDir = path.join(cursorDir, 'rules');

  // Ensure directories exist
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.mkdirSync(rulesDir, { recursive: true });

  // Write MCP config (merge with existing)
  const mcpPath = path.join(cursorDir, 'mcp.json');
  let existing: any = { mcpServers: {} };
  if (fs.existsSync(mcpPath)) {
    try { existing = JSON.parse(fs.readFileSync(mcpPath, 'utf-8')); } catch {}
  }
  existing.mcpServers = existing.mcpServers || {};
  existing.mcpServers.entendi = {
    url: `${opts.apiUrl}/mcp`,
    headers: { 'x-api-key': opts.apiKey },
  };
  fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n');

  // Write always-apply rule
  const rulePath = path.join(rulesDir, 'entendi.mdc');
  const ruleTemplate = fs.readFileSync(
    path.join(__dirname, '..', 'templates', 'cursor-rule.mdc'), 'utf-8'
  );
  fs.writeFileSync(rulePath, ruleTemplate);
}
```

**Step 4: Run test — PASS**

**Step 5: Commit**

```bash
git commit -m "feat: Cursor config writer (MCP + always-apply rule)"
```

---

### Task 10: CLI Installer — Codex Config Writer

**Files:**
- Create: `src/cli/platforms/codex.ts`
- Test: `tests/cli/codex.test.ts`

**Step 1: Write test**

```typescript
describe('configureCodex', () => {
  it('writes skill directory with SKILL.md', () => {
    configureCodex('/project', { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });
    const calls = vi.mocked(fs.writeFileSync).mock.calls;
    const skillCall = calls.find(c => String(c[0]).includes('SKILL.md'));
    expect(skillCall).toBeDefined();
    expect(String(skillCall![1])).toContain('entendi-concept-detection');
  });

  it('appends to AGENTS.md without duplicating', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Existing content\n');
    configureCodex('/project', { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });
    const calls = vi.mocked(fs.writeFileSync).mock.calls;
    const agentsCall = calls.find(c => String(c[0]).includes('AGENTS.md'));
    expect(agentsCall).toBeDefined();
    expect(String(agentsCall![1])).toContain('Entendi');
    expect(String(agentsCall![1])).toContain('Existing content');
  });

  it('writes MCP config to .codex/config.toml', () => {
    configureCodex('/project', { apiKey: 'test-key', apiUrl: 'https://api.entendi.dev' });
    const calls = vi.mocked(fs.writeFileSync).mock.calls;
    const tomlCall = calls.find(c => String(c[0]).includes('config.toml'));
    expect(tomlCall).toBeDefined();
  });
});
```

**Step 2: Implement Codex config writer**

Create `src/cli/platforms/codex.ts` — writes `.codex/config.toml` (MCP entry), skill directory, and AGENTS.md snippet.

**Step 3: Run test — PASS**

**Step 4: Commit**

```bash
git commit -m "feat: Codex config writer (TOML + skill + AGENTS.md)"
```

---

### Task 11: CLI Installer — Main Entry Point

**Files:**
- Create: `src/cli/init.ts`
- Modify: `package.json` (bin field)
- Modify: `esbuild.config.ts` (CLI bundle)

**Step 1: Implement the CLI entry point**

Create `src/cli/init.ts`:

```typescript
#!/usr/bin/env node
import { detectPlatforms } from './platforms/detect.js';
import { configureCursor } from './platforms/cursor.js';
import { configureCodex } from './platforms/codex.js';
import { loadConfig } from '../shared/config.js';
import * as readline from 'node:readline';

async function main() {
  const projectDir = process.cwd();
  console.log('🧠 Entendi — Setting up comprehension tracking\n');

  // 1. Load or create config
  let config = loadConfig();
  if (!config.apiKey) {
    console.log('No API key found. Visit https://entendi.dev to create an account,');
    console.log('then run: entendi_login in your AI coding tool.\n');
    console.log('Or set ENTENDI_API_KEY environment variable.\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const apiKey = await new Promise<string>((resolve) => {
      rl.question('Paste your API key (or press Enter to skip): ', resolve);
    });
    rl.close();

    if (apiKey.trim()) {
      const { saveConfig } = await import('../shared/config.js');
      saveConfig({ apiKey: apiKey.trim() });
      config = { ...config, apiKey: apiKey.trim() };
    }
  }

  // 2. Detect platforms
  const platforms = detectPlatforms(projectDir);
  if (platforms.length === 0) {
    console.log('No AI coding tools detected in this project.');
    console.log('Supported: Claude Code, Cursor, Codex, VS Code, OpenCode');
    console.log('\nYou can still use Entendi by adding the remote MCP URL:');
    console.log(`  ${config.apiUrl || 'https://api.entendi.dev'}/mcp\n`);
    process.exit(0);
  }

  console.log(`Detected platforms: ${platforms.join(', ')}\n`);

  const apiUrl = config.apiUrl || 'https://api.entendi.dev';
  const opts = { apiKey: config.apiKey || '', apiUrl };

  // 3. Configure each platform
  for (const platform of platforms) {
    switch (platform) {
      case 'claude-code':
        console.log('✓ Claude Code — use: claude plugin install entendi');
        break;
      case 'cursor':
        configureCursor(projectDir, opts);
        console.log('✓ Cursor — wrote .cursor/mcp.json + .cursor/rules/entendi.mdc');
        break;
      case 'codex':
        configureCodex(projectDir, opts);
        console.log('✓ Codex — wrote .codex/config.toml + skill + AGENTS.md');
        break;
      case 'vscode':
        console.log('✓ VS Code — remote MCP URL: ' + apiUrl + '/mcp');
        break;
      case 'opencode':
        console.log('⊘ OpenCode — support coming soon');
        break;
    }
  }

  console.log('\nDone! Entendi is ready. Start coding and concepts will be tracked automatically.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

**Step 2: Add bin field to package.json**

```json
{
  "bin": {
    "entendi": "./dist/cli/init.js"
  }
}
```

**Step 3: Add CLI bundle to esbuild.config.ts**

Add a new build entry for `src/cli/init.ts` → `dist/cli/init.js`, platform: node22, ESM, with `#!/usr/bin/env node` banner.

**Step 4: Build and test locally**

```bash
npm run build
node dist/cli/init.js
```

**Step 5: Commit**

```bash
git commit -m "feat: npx entendi init CLI installer"
```

---

### Task 12: CLI — Integration Test

**Files:**
- Create: `tests/cli/init.test.ts`

**Step 1: Write integration test**

Test that `npx entendi init` in a temp directory with `.cursor/` creates the right files:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('entendi init integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entendi-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates Cursor config when .cursor/ exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'));
    // Run configureCursor directly
    const { configureCursor } = require('../../src/cli/platforms/cursor.js');
    configureCursor(tmpDir, { apiKey: 'test', apiUrl: 'https://api.entendi.dev' });

    expect(fs.existsSync(path.join(tmpDir, '.cursor', 'mcp.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.cursor', 'rules', 'entendi.mdc'))).toBe(true);

    const mcpConfig = JSON.parse(fs.readFileSync(path.join(tmpDir, '.cursor', 'mcp.json'), 'utf-8'));
    expect(mcpConfig.mcpServers.entendi.url).toBe('https://api.entendi.dev/mcp');
  });
});
```

**Step 2: Run — PASS**

**Step 3: Commit**

```bash
git commit -m "test: CLI integration tests for platform config writers"
```

---

### Task 13: Build Pipeline — CLI Bundle

**Files:**
- Modify: `esbuild.config.ts`

**Step 1: Add CLI build step**

Add after the MCP bundle section:

```typescript
// CLI bundle
await esbuild.build({
  entryPoints: ['src/cli/init.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/cli/init.js',
  banner: { js: '#!/usr/bin/env node' },
  external: ['@anthropic-ai/sdk'],
});
```

**Step 2: Copy templates into dist**

Add a step to copy `src/cli/templates/` → `dist/cli/templates/` during build.

**Step 3: Build and verify**

```bash
npm run build
ls dist/cli/
# Should show: init.js, templates/
```

**Step 4: Commit**

```bash
git commit -m "chore: add CLI bundle to esbuild pipeline"
```

---

### Task 14: Update package.json for npx Distribution

**Files:**
- Modify: `package.json`

**Step 1: Add bin and files fields**

```json
{
  "bin": {
    "entendi": "dist/cli/init.js"
  },
  "files": [
    "dist/cli/",
    "dist/mcp/"
  ]
}
```

**Step 2: Test npx locally**

```bash
npm run build
npm link
entendi init
npm unlink
```

**Step 3: Commit**

```bash
git commit -m "chore: configure package.json for npx entendi distribution"
```

---

### Task 15: Full Test Suite + Deploy

**Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass (930+ existing + ~15 new)

**Step 2: Build**

```bash
npm run build
```

**Step 3: Deploy**

```bash
npx wrangler deploy
```

**Step 4: Smoke test remote MCP endpoint**

```bash
# Test initialize
curl -s -X POST https://api.entendi.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}'

# Test tools/list with auth
curl -s -X POST https://api.entendi.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: YOUR_KEY' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Test observe
curl -s -X POST https://api.entendi.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: YOUR_KEY' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"entendi_observe","arguments":{"concepts":[{"id":"test","name":"Test","source":"llm"}]}}}'
```

**Step 5: Commit**

```bash
git commit -m "chore: deploy remote MCP + verify smoke tests"
```

---

### Task 16: End-to-End Cursor Test

**Step 1: Test in Cursor**

1. Open a project in Cursor
2. Create `.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "entendi": {
         "url": "https://api.entendi.dev/mcp",
         "headers": { "x-api-key": "YOUR_KEY" }
       }
     }
   }
   ```
3. Create `.cursor/rules/entendi.mdc` (copy from templates)
4. Start a conversation about a technical topic
5. Verify the agent calls `entendi_observe`
6. Verify probes appear with the 🧠 format

**Step 2: Document any issues**

**Step 3: Commit any fixes**

---

### Task 17: End-to-End Codex Test

**Step 1: Test in Codex CLI**

1. Install Codex CLI: `npm i -g @openai/codex`
2. Configure MCP in `.codex/config.toml`:
   ```toml
   [mcp.entendi]
   type = "http"
   url = "https://api.entendi.dev/mcp"
   headers = { x-api-key = "YOUR_KEY" }
   ```
3. Copy skill to `.codex/skills/entendi-concept-detection/SKILL.md`
4. Add AGENTS.md snippet
5. Start Codex, discuss a technical topic
6. Verify observe/probe flow

**Step 2: Document any issues**

**Step 3: Commit any fixes**

---

### Task 18: Documentation and README Update

**Files:**
- Modify: `README.md` (if exists) or `CLAUDE.md`
- Create: `docs/multi-platform-setup.md`

**Step 1: Write setup docs for each platform**

Document:
- **Any platform (30 seconds)**: Add remote MCP URL
- **Cursor**: `npx entendi init` or manual `.cursor/mcp.json` + `.cursor/rules/entendi.mdc`
- **Codex**: `npx entendi init` or manual config + skill + AGENTS.md
- **Claude Code**: `claude plugin install entendi` (unchanged)

**Step 2: Commit**

```bash
git commit -m "docs: multi-platform setup guide"
```

---

## Dependency Graph

```
Task 1  → Task 2  → Task 3  → Task 4 (Remote MCP)
Task 5  → Task 6  → Task 7  (Templates)
Task 8  → Task 9  → Task 10 → Task 11 → Task 12 → Task 13 → Task 14 (CLI)
Task 4 + Task 14 → Task 15 (Deploy)
Task 15 → Task 16 (Cursor E2E)
Task 15 → Task 17 (Codex E2E)
Task 16 + Task 17 → Task 18 (Docs)
```

Tasks 1-4 (Remote MCP) and Tasks 5-7 (Templates) and Tasks 8-14 (CLI) can be parallelized across 3 teammates.
