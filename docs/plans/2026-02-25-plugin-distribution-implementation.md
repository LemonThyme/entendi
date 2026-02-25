# Plugin Distribution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package Entendi as a Claude Code plugin so users can install it with a single command.

**Architecture:** Static plugin metadata lives in `plugin/` (version-controlled). The build step copies these files + bundled JS into `dist/plugin/`, a self-contained plugin directory. Existing build outputs (`dist/hooks/`, `dist/mcp/`) stay unchanged for local dev.

**Tech Stack:** esbuild (existing), Node.js `fs` APIs for file copying

---

### Task 1: Create Static Plugin Metadata Files

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`
- Create: `plugin/.mcp.json`
- Create: `plugin/hooks/hooks.json`

**Step 1: Create the plugin manifest**

Create `plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "entendi",
  "description": "Comprehension accountability layer for AI-assisted work",
  "version": "0.1.0",
  "author": { "name": "TK" },
  "repository": "https://github.com/tk/entendi",
  "license": "MIT",
  "keywords": ["comprehension", "learning", "bayesian", "knowledge-graph"]
}
```

**Step 2: Create the MCP config**

Create `plugin/.mcp.json` (direct format per plugin convention):

```json
{
  "entendi": {
    "command": "node",
    "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"]
  }
}
```

**Step 3: Create the hooks config**

Create `plugin/hooks/hooks.json`:

```json
{
  "description": "Entendi comprehension probing hooks",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node '${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use.js'",
            "timeout": 30
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node '${CLAUDE_PLUGIN_ROOT}/hooks/user-prompt-submit.js'",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**Step 4: Commit**

```bash
git add plugin/
git commit -m "feat: add static plugin metadata files"
```

---

### Task 2: Create Self-Hosted Marketplace Manifest

**Files:**
- Create: `.claude-plugin/marketplace.json`

**Step 1: Create the marketplace manifest**

Create `.claude-plugin/marketplace.json` at repo root:

```json
{
  "name": "entendi",
  "description": "Comprehension accountability layer for AI-assisted work",
  "owner": { "name": "TK" },
  "plugins": [
    {
      "name": "entendi",
      "description": "Comprehension accountability layer for AI-assisted work",
      "version": "0.1.0",
      "source": "./dist/plugin",
      "category": "learning"
    }
  ]
}
```

**Step 2: Commit**

```bash
git add .claude-plugin/
git commit -m "feat: add self-hosted marketplace manifest"
```

---

### Task 3: Update Build to Produce Plugin Directory

**Files:**
- Modify: `esbuild.config.ts`
- Modify: `package.json`

**Step 1: Write test for plugin build output**

Create `tests/build/plugin-output.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const pluginDir = join(process.cwd(), 'dist', 'plugin');

describe('plugin build output', () => {
  it('has plugin manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8'),
    );
    expect(manifest.name).toBe('entendi');
    expect(manifest.version).toBeDefined();
  });

  it('has MCP config with CLAUDE_PLUGIN_ROOT', () => {
    const mcp = JSON.parse(
      readFileSync(join(pluginDir, '.mcp.json'), 'utf-8'),
    );
    expect(mcp.entendi).toBeDefined();
    expect(mcp.entendi.args[0]).toContain('${CLAUDE_PLUGIN_ROOT}');
  });

  it('has hooks config with CLAUDE_PLUGIN_ROOT', () => {
    const hooks = JSON.parse(
      readFileSync(join(pluginDir, 'hooks', 'hooks.json'), 'utf-8'),
    );
    expect(hooks.hooks.PostToolUse).toBeDefined();
    expect(hooks.hooks.UserPromptSubmit).toBeDefined();
    const cmd = hooks.hooks.PostToolUse[0].hooks[0].command;
    expect(cmd).toContain('${CLAUDE_PLUGIN_ROOT}');
  });

  it('has bundled MCP server', () => {
    expect(existsSync(join(pluginDir, 'mcp', 'server.js'))).toBe(true);
  });

  it('has bundled hook scripts', () => {
    expect(existsSync(join(pluginDir, 'hooks', 'post-tool-use.js'))).toBe(true);
    expect(existsSync(join(pluginDir, 'hooks', 'user-prompt-submit.js'))).toBe(true);
  });

  it('does not include non-entrypoint hook files', () => {
    // shared.js and stop.js are internal — not needed in plugin
    expect(existsSync(join(pluginDir, 'hooks', 'shared.js'))).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/plugin-output.test.ts`
Expected: FAIL — `dist/plugin/` doesn't exist yet

**Step 3: Update esbuild.config.ts to add plugin assembly**

Replace the entire contents of `esbuild.config.ts` with:

```typescript
import * as esbuild from 'esbuild';
import { chmodSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, basename } from 'path';

const hookDir = join('src', 'hooks');
let hookFiles: string[] = [];
try {
  hookFiles = readdirSync(hookDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => join(hookDir, f));
} catch {
  // hooks dir may not exist yet
}

// --- Existing builds (local dev) ---

if (hookFiles.length > 0) {
  await esbuild.build({
    entryPoints: hookFiles,
    bundle: true,
    platform: 'node',
    target: 'node22',
    outdir: 'dist/hooks',
    format: 'esm',
    banner: { js: '#!/usr/bin/env node' },
    external: ['@anthropic-ai/sdk'],
  });
}

await esbuild.build({
  entryPoints: [join('src', 'mcp', 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outdir: 'dist/mcp',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  external: ['@anthropic-ai/sdk'],
});

// Make all built entry points executable
const outputs = [
  ...hookFiles.map(f => join('dist', 'hooks', f.replace(/^src\/hooks\//, '').replace(/\.ts$/, '.js'))),
  join('dist', 'mcp', 'server.js'),
];
for (const out of outputs) {
  try {
    chmodSync(out, 0o755);
  } catch {
    // file may not exist if build was partial
  }
}

// --- Plugin assembly ---

const pluginDir = join('dist', 'plugin');

/** Recursively copy a directory, creating parents as needed. */
function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy static plugin metadata
if (existsSync('plugin')) {
  copyDir('plugin', pluginDir);
}

// 2. Copy bundled hook entrypoints (only the two CLI scripts)
const hookEntrypoints = ['post-tool-use.js', 'user-prompt-submit.js'];
mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
for (const file of hookEntrypoints) {
  const src = join('dist', 'hooks', file);
  if (existsSync(src)) {
    copyFileSync(src, join(pluginDir, 'hooks', file));
    chmodSync(join(pluginDir, 'hooks', file), 0o755);
  }
}

// 3. Copy bundled MCP server
mkdirSync(join(pluginDir, 'mcp'), { recursive: true });
const mcpSrc = join('dist', 'mcp', 'server.js');
if (existsSync(mcpSrc)) {
  copyFileSync(mcpSrc, join(pluginDir, 'mcp', 'server.js'));
  chmodSync(join(pluginDir, 'mcp', 'server.js'), 0o755);
}
```

**Step 4: Add build:plugin script to package.json**

In `package.json`, add to `scripts`:

```json
"build:plugin": "npm run build && echo 'Plugin assembled at dist/plugin/'"
```

No separate script needed — plugin assembly is now part of the esbuild step which runs during `npm run build`.

**Step 5: Run build and verify tests pass**

Run: `npm run build && npx vitest run tests/build/plugin-output.test.ts`
Expected: PASS — all 6 assertions

**Step 6: Run full test suite to verify nothing broke**

Run: `npm test`
Expected: All 375+ tests pass

**Step 7: Commit**

```bash
git add esbuild.config.ts package.json tests/build/plugin-output.test.ts
git commit -m "feat: build step assembles plugin directory at dist/plugin/"
```

---

### Task 4: Update .gitignore and Documentation

**Files:**
- Modify: `.gitignore`
- Modify: `examples/claude-code-settings.json`

**Step 1: Verify .gitignore already covers dist/**

The existing `.gitignore` has `dist/` which covers `dist/plugin/`. No change needed.

Verify `.claude-plugin/` is NOT in `.gitignore` (the marketplace manifest must be tracked):

Run: `grep -c '.claude-plugin' .gitignore`
Expected: 0

**Step 2: Update examples/claude-code-settings.json**

Read the file and add a comment about the plugin approach being preferred. The existing example stays valid for local dev.

**Step 3: Commit**

```bash
git add examples/ .gitignore
git commit -m "docs: update examples for plugin distribution"
```

---

### Task 5: End-to-End Plugin Verification

**Step 1: Clean build and verify plugin**

Run: `rm -rf dist && npm run build`
Expected: `dist/plugin/` exists with all expected files

**Step 2: Verify plugin structure**

Run: `find dist/plugin -type f | sort`
Expected output:
```
dist/plugin/.claude-plugin/plugin.json
dist/plugin/.mcp.json
dist/plugin/hooks/hooks.json
dist/plugin/hooks/post-tool-use.js
dist/plugin/hooks/user-prompt-submit.js
dist/plugin/mcp/server.js
```

**Step 3: Verify MCP server runs from plugin path**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | timeout 5 node dist/plugin/mcp/server.js 2>/dev/null; echo`
Expected: JSON-RPC response with `"result"` containing server capabilities

**Step 4: Run full test suite one final time**

Run: `npm test`
Expected: All tests pass (375+ including new plugin-output tests)

**Step 5: Commit design doc**

```bash
git add docs/plans/2026-02-25-plugin-distribution-design.md docs/plans/2026-02-25-plugin-distribution-implementation.md
git commit -m "docs: add plugin distribution design and implementation plan"
```
