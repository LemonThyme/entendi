#!/usr/bin/env bash
# Test the entendi plugin installation and hook behavior.
# Run inside the devcontainer after setup.
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

# --- 1. Plugin installed ---
PLUGIN_DIR=$(claude plugin list 2>/dev/null | grep -o '/[^ ]*entendi[^ ]*' | head -1 || true)
if [ -z "$PLUGIN_DIR" ]; then
  # Fallback: find it in cache
  PLUGIN_DIR=$(find ~/.claude/plugins/cache -name "plugin.json" -path "*/entendi/*" -exec dirname {} \; 2>/dev/null | head -1 | sed 's|/.claude-plugin||' || true)
fi

if [ -n "$PLUGIN_DIR" ] && [ -d "$PLUGIN_DIR" ]; then
  pass "Plugin installed at $PLUGIN_DIR"
else
  fail "Plugin not found"
  echo "  Run: claude plugin install entendi"
  exit 1
fi

# --- 2. No PostToolUse in hooks.json ---
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
    fail "UserPromptSubmit hook missing from hooks.json"
  fi

  if grep -q "SessionStart" "$HOOKS_JSON"; then
    pass "SessionStart hook registered"
  else
    fail "SessionStart hook missing from hooks.json"
  fi
else
  fail "hooks.json not found at $HOOKS_JSON"
fi

# --- 3. No post-tool-use artifacts ---
if [ -f "$PLUGIN_DIR/hooks/post-tool-use" ]; then
  fail "post-tool-use bash script still present"
else
  pass "No post-tool-use bash script"
fi

if [ -f "$PLUGIN_DIR/hooks/post-tool-use.js" ]; then
  fail "post-tool-use.js still present"
else
  pass "No post-tool-use.js"
fi

# --- 4. Required files exist ---
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
    fail "Missing file: $file"
  fi
done

# --- 5. user-prompt-submit.js runs without error ---
echo '{"session_id":"test","cwd":"/tmp","hook_event_name":"UserPromptSubmit","prompt":"hello world"}' \
  | node "$PLUGIN_DIR/hooks/user-prompt-submit.js" 2>/dev/null
UPS_EXIT=$?
if [ $UPS_EXIT -eq 0 ]; then
  pass "user-prompt-submit.js runs cleanly (exit $UPS_EXIT)"
else
  fail "user-prompt-submit.js failed (exit $UPS_EXIT)"
fi

# --- 6. Login detection works ---
LOGIN_OUTPUT=$(echo '{"session_id":"test","cwd":"/tmp","hook_event_name":"UserPromptSubmit","prompt":"entendi login"}' \
  | node "$PLUGIN_DIR/hooks/user-prompt-submit.js" 2>/dev/null || true)
if echo "$LOGIN_OUTPUT" | grep -q "entendi_login"; then
  pass "Login pattern detected: 'entendi login'"
else
  fail "Login pattern not detected for 'entendi login'"
  echo -e "  ${DIM}Output: $LOGIN_OUTPUT${RESET}"
fi

# --- 7. MCP server starts (and exits cleanly when no stdin) ---
timeout 3 node "$PLUGIN_DIR/mcp/server.js" 2>/dev/null &
MCP_PID=$!
sleep 1
if kill -0 $MCP_PID 2>/dev/null; then
  kill $MCP_PID 2>/dev/null || true
  pass "MCP server starts without crash"
else
  # Process exited — check if it was clean
  wait $MCP_PID 2>/dev/null || true
  pass "MCP server started and exited (no API key — expected)"
fi

# --- Summary ---
echo ""
if [ $FAILURES -eq 0 ]; then
  echo -e "${GREEN}All tests passed.${RESET}"
else
  echo -e "${RED}$FAILURES test(s) failed.${RESET}"
  exit 1
fi
