#!/usr/bin/env bash
# Test the entendi plugin build output and hook behavior.
# Works both inside the devcontainer and locally after `npm run build`.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[2m'
RESET='\033[0m'

pass() { echo -e "${GREEN}PASS${RESET} $1"; }
fail() { echo -e "${RED}FAIL${RESET} $1"; FAILURES=$((FAILURES + 1)); }

FAILURES=0

echo "=== Entendi Plugin Test Suite ==="
echo ""

# Determine plugin directory: installed cache or built dist/plugin
PLUGIN_DIR=""
# 1. Try installed plugin cache
PLUGIN_DIR=$(find ~/.claude/plugins/cache -name "plugin.json" -path "*/entendi/*" -exec dirname {} \; 2>/dev/null | head -1 | sed 's|/.claude-plugin||' || true)
# 2. Fall back to dist/plugin (CI or local build)
if [ -z "$PLUGIN_DIR" ] || [ ! -d "$PLUGIN_DIR" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  PLUGIN_DIR="$REPO_ROOT/dist/plugin"
fi

if [ -d "$PLUGIN_DIR" ]; then
  pass "Plugin found at $PLUGIN_DIR"
else
  fail "Plugin not found (run npm run build first)"
  exit 1
fi

# --- 1. No PostToolUse in hooks.json ---
HOOKS_JSON="$PLUGIN_DIR/hooks/hooks.json"
if [ -f "$HOOKS_JSON" ]; then
  if grep -q "PostToolUse" "$HOOKS_JSON"; then
    fail "hooks.json still contains PostToolUse"
  else
    pass "No PostToolUse in hooks.json"
  fi

  if grep -q "UserPromptSubmit" "$HOOKS_JSON"; then
    pass "UserPromptSubmit hook registered"
  else
    fail "UserPromptSubmit hook missing"
  fi

  if grep -q "SessionStart" "$HOOKS_JSON"; then
    pass "SessionStart hook registered"
  else
    fail "SessionStart hook missing"
  fi
else
  fail "hooks.json not found"
fi

# --- 2. No post-tool-use artifacts ---
for f in post-tool-use post-tool-use.js; do
  if [ -f "$PLUGIN_DIR/hooks/$f" ]; then
    fail "$f still present"
  else
    pass "No $f"
  fi
done

# --- 3. Required files exist ---
for file in \
  "hooks/user-prompt-submit" \
  "hooks/user-prompt-submit.js" \
  "hooks/session-start" \
  "mcp/server.js" \
  "skills/concept-detection/SKILL.md" \
  ".claude-plugin/plugin.json" \
  ".mcp.json"; do
  if [ -f "$PLUGIN_DIR/$file" ]; then
    pass "File exists: $file"
  else
    fail "Missing: $file"
  fi
done

# --- 4. user-prompt-submit.js runs without error ---
echo '{"session_id":"test","cwd":"/tmp","hook_event_name":"UserPromptSubmit","prompt":"hello world"}' \
  | node "$PLUGIN_DIR/hooks/user-prompt-submit.js" 2>/dev/null
UPS_EXIT=$?
if [ $UPS_EXIT -eq 0 ]; then
  pass "user-prompt-submit.js runs cleanly"
else
  fail "user-prompt-submit.js failed (exit $UPS_EXIT)"
fi

# --- 5. Login detection ---
LOGIN_OUTPUT=$(echo '{"session_id":"test","cwd":"/tmp","hook_event_name":"UserPromptSubmit","prompt":"entendi login"}' \
  | node "$PLUGIN_DIR/hooks/user-prompt-submit.js" 2>/dev/null || true)
if echo "$LOGIN_OUTPUT" | grep -q "entendi_login"; then
  pass "Login detection: 'entendi login'"
else
  fail "Login detection failed"
  echo -e "  ${DIM}Output: $LOGIN_OUTPUT${RESET}"
fi

# --- 6. Teach-me detection ---
TEACH_OUTPUT=$(echo '{"session_id":"test","cwd":"/tmp","hook_event_name":"UserPromptSubmit","prompt":"teach me about Redis"}' \
  | node "$PLUGIN_DIR/hooks/user-prompt-submit.js" 2>/dev/null || true)
if echo "$TEACH_OUTPUT" | grep -q "entendi_start_tutor"; then
  pass "Teach-me detection: 'teach me about Redis'"
else
  fail "Teach-me detection failed"
  echo -e "  ${DIM}Output: $TEACH_OUTPUT${RESET}"
fi

# --- 7. Normal message produces no output ---
NORMAL_OUTPUT=$(echo '{"session_id":"test","cwd":"/tmp","hook_event_name":"UserPromptSubmit","prompt":"fix the bug in line 42"}' \
  | node "$PLUGIN_DIR/hooks/user-prompt-submit.js" 2>/dev/null || true)
if [ -z "$NORMAL_OUTPUT" ]; then
  pass "Normal message: no output (silent)"
else
  fail "Normal message produced unexpected output"
  echo -e "  ${DIM}Output: $NORMAL_OUTPUT${RESET}"
fi

# --- 8. Session-start outputs skill ---
SKILL_OUTPUT=$(bash "$PLUGIN_DIR/hooks/session-start" 2>/dev/null || true)
if echo "$SKILL_OUTPUT" | grep -q "concept-detection"; then
  pass "Session-start injects concept-detection skill"
else
  fail "Session-start skill injection failed"
fi

# --- Summary ---
echo ""
if [ $FAILURES -eq 0 ]; then
  echo -e "${GREEN}All tests passed.${RESET}"
else
  echo -e "${RED}$FAILURES test(s) failed.${RESET}"
  exit 1
fi
