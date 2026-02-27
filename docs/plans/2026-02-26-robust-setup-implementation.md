# Robust Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make entendi setup bulletproof — auto-bust plugin cache on every build, provide a single `setup.sh` that validates everything, update README.

**Architecture:** Build-time version stamping in `esbuild.config.ts` writes `0.1.0+<git-hash>` into the assembled `plugin.json`, so Claude Code never serves stale cache. A `setup.sh` script validates prerequisites and runs the full pipeline with clear error messages.

**Tech Stack:** Bash, Node.js `execFileSync`, esbuild config (TypeScript)

---

### Task 1: Add version stamping to esbuild.config.ts

**Files:**
- Modify: `esbuild.config.ts:2` (add `readFileSync` to import)
- Modify: `esbuild.config.ts:3` (add `execFileSync` import)
- Modify: `esbuild.config.ts:78` (add stamp logic after plugin copy)

**Step 1: Add the version stamp logic**

Add `readFileSync` to the existing `fs` import on line 2:

```typescript
import { chmodSync, readdirSync, mkdirSync, copyFileSync, existsSync, writeFileSync, rmSync, readFileSync } from 'fs';
```

Add a new import after line 3:

```typescript
import { execFileSync } from 'child_process';
```

Then add this block right after the `copyDir('plugin', pluginDir)` closing brace (after line 78):

```typescript
// 1b. Stamp plugin version with git hash to bust Claude Code's plugin cache
let gitHash = 'unknown';
try {
  gitHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
} catch {
  // not in a git repo — use timestamp as fallback
  gitHash = Date.now().toString(36);
}

const pluginJsonPath = join(pluginDir, '.claude-plugin', 'plugin.json');
if (existsSync(pluginJsonPath)) {
  const pluginMeta = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
  pluginMeta.version = `${pluginMeta.version}+${gitHash}`;
  writeFileSync(pluginJsonPath, JSON.stringify(pluginMeta, null, 2) + '\n');
  console.log(`Plugin version stamped: ${pluginMeta.version}`);
}
```

**Step 2: Run the build to verify stamping works**

Run: `npm run build 2>&1 | tail -5`

Expected: Output includes `Plugin version stamped: 0.1.0+<some-hash>`

**Step 3: Verify the stamped plugin.json**

Run: `cat dist/plugin/.claude-plugin/plugin.json`

Expected: `"version": "0.1.0+abc1234"` (hash will vary)

**Step 4: Verify source plugin.json is unchanged**

Run: `cat plugin/.claude-plugin/plugin.json`

Expected: `"version": "0.1.0"` (no hash — source stays clean)

**Step 5: Commit**

```bash
git add esbuild.config.ts
git commit -m "fix: stamp plugin version with git hash to bust cache on every build"
```

---

### Task 2: Create setup.sh

**Files:**
- Create: `setup.sh`

**Step 1: Write the setup script**

Create `setup.sh` at the repo root:

```bash
#!/usr/bin/env bash
# Entendi setup — validates prerequisites, builds, and installs the plugin.
# Run this once after cloning, or any time you want a clean install.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${BOLD}▸${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$1"; }
fail()  { printf "${RED}✗ %s${NC}\n" "$1"; exit 1; }

echo ""
echo "  ${BOLD}Entendi Setup${NC}"
echo ""

# ── 1. Check Node >= 22 ──────────────────────────────────────────────
info "Checking Node.js version..."
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node 22+ from https://nodejs.org"
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node $NODE_MAJOR found, but Node 22+ is required. Update: https://nodejs.org"
fi
ok "Node $(node -v)"

# ── 2. Check .env ────────────────────────────────────────────────────
info "Checking .env..."
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    warn "Created .env from .env.example"
    echo ""
    echo "  ${BOLD}Action required:${NC} Open .env and fill in:"
    echo "    DATABASE_URL       — your Neon PostgreSQL connection string"
    echo "    BETTER_AUTH_SECRET — run: openssl rand -base64 32"
    echo ""
    echo "  Then re-run this script."
    exit 1
  else
    fail ".env.example not found — is this the entendi repo root?"
  fi
fi
ok ".env exists"

# ── 3. Validate required env vars ────────────────────────────────────
info "Validating environment variables..."
set -a
source .env
set +a

if [ -z "${DATABASE_URL:-}" ] || [[ "$DATABASE_URL" == *"user:pass"* ]]; then
  fail "DATABASE_URL is missing or still has placeholder value. Update .env"
fi

if [ -z "${BETTER_AUTH_SECRET:-}" ] || [[ "$BETTER_AUTH_SECRET" == *"generate-with"* ]]; then
  fail "BETTER_AUTH_SECRET is missing or still has placeholder value. Run: openssl rand -base64 32"
fi
ok "Required env vars set"

# ── 4. npm install ───────────────────────────────────────────────────
info "Installing dependencies..."
npm install --no-fund --no-audit
ok "Dependencies installed"

# ── 5. Build ─────────────────────────────────────────────────────────
info "Building hooks, MCP server, plugin, and dashboard..."
npm run build
ok "Build complete"

# ── 6. Clear plugin cache ────────────────────────────────────────────
info "Clearing plugin cache..."
rm -rf ~/.claude/plugins/cache/entendi
ok "Plugin cache cleared"

# ── 7. Install plugin ───────────────────────────────────────────────
info "Installing Claude Code plugin..."
if ! command -v claude &>/dev/null; then
  warn "Claude Code CLI not found — skipping plugin install"
  echo "  Install it with: npm install -g @anthropic-ai/claude-code"
  echo "  Then run: claude plugin install entendi"
else
  claude plugin install entendi
  ok "Plugin installed"
fi

# ── Done ─────────────────────────────────────────────────────────────
echo ""
echo "  ${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo "  Next steps:"
echo "    1. Start Claude Code:  claude"
echo "    2. Link your account:  say \"entendi login\""
echo "    3. Start coding — Entendi activates automatically"
echo ""
```

**Step 2: Make it executable**

Run: `chmod +x setup.sh`

**Step 3: Test the script**

Run: `./setup.sh`

Expected: All steps pass with green checkmarks. Final message says "Setup complete!"

**Step 4: Commit**

```bash
git add setup.sh
git commit -m "feat: add setup.sh for bulletproof first-time setup"
```

---

### Task 3: Update README

**Files:**
- Modify: `README.md:88-114` (Development section)

**Step 1: Rewrite the Development section**

Replace lines 88-114 (the Development section, Plugin Development section, and stale cache instructions) with:

```markdown
## Development

```bash
git clone https://github.com/LemonThyme/entendi.git
cd entendi
./setup.sh
```

The setup script validates Node 22+, checks your `.env`, installs dependencies, builds everything, and installs the plugin. Run it once after cloning.

### After code changes

```bash
npm run plugin:reinstall    # build + reinstall plugin
```

The build stamps each plugin version with the git hash, so Claude Code always picks up your latest changes.

### Commands

| Command | What it does |
|---------|-------------|
| `npm run api:dev` | Local API server (port 3456) |
| `npm run build` | Build hooks, MCP, plugin, dashboard |
| `npm run plugin:reinstall` | Build + clear cache + reinstall plugin |
| `npm test` | Run tests |
| `npx wrangler deploy` | Deploy to Cloudflare Workers |
```

**Step 2: Verify no sections were lost**

Read through README.md — the Devcontainer, Deploy, Debug, and License sections (lines 116-137) should still be intact below the new Development section.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: simplify setup instructions to use setup.sh"
```

---

### Task 4: Update CLAUDE.md setup section

**Files:**
- Modify: `CLAUDE.md` (Setup section)

**Step 1: Update the Setup section**

In CLAUDE.md, find the `## Setup` section and replace its content with:

```markdown
## Setup

```bash
git clone https://github.com/LemonThyme/entendi.git
cd entendi
./setup.sh    # validates prereqs, builds, installs plugin
```

For manual setup or CI:

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and BETTER_AUTH_SECRET
npm run build           # builds hooks, MCP server, plugin, dashboard assets
```
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: reference setup.sh in CLAUDE.md"
```

---

### Task 5: Verify end-to-end

**Step 1: Simulate fresh install**

Run:
```bash
rm -rf ~/.claude/plugins/cache/entendi
npm run build
claude plugin install entendi
```

**Step 2: Verify cached version has git hash**

Run: `cat ~/.claude/plugins/cache/entendi/entendi/*/.claude-plugin/plugin.json`

Expected: `"version": "0.1.0+<hash>"`

**Step 3: Rebuild and reinstall without clearing cache**

Run: `npm run plugin:reinstall`

Expected: Plugin installs successfully with new version hash.

**Step 4: Run tests to make sure nothing broke**

Run: `npm test`

Expected: All tests pass.
