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
printf "  ${BOLD}Entendi Setup${NC}\n"
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
    printf "  ${BOLD}Action required:${NC} Open .env and fill in:\n"
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

# ── 3b. Install git hooks ──────────────────────────────────────────────
info "Installing git hooks..."
cp scripts/commit-msg.sh .git/hooks/commit-msg
chmod +x .git/hooks/commit-msg
ok "commit-msg hook installed (enforces Conventional Commits)"

# ── 4. Clean stale artifacts ──────────────────────────────────────────
info "Cleaning stale build artifacts..."
rm -rf dist
rm -rf ~/.claude/plugins/cache/entendi
ok "Build output and plugin cache cleared"

# ── 5. npm install ───────────────────────────────────────────────────
info "Installing dependencies..."
npm install --no-fund --no-audit
ok "Dependencies installed"

# ── 6. Build ─────────────────────────────────────────────────────────
info "Building hooks, MCP server, plugin, and dashboard..."
npm run build
ok "Build complete"

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
printf "  ${GREEN}${BOLD}Setup complete!${NC}\n"
echo ""
echo "  Next steps:"
echo "    1. Start Claude Code:  claude"
echo '    2. Link your account:  say "entendi login"'
echo "    3. Start coding — Entendi activates automatically"
echo ""
