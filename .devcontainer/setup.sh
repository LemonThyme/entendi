#!/usr/bin/env bash
# Post-create setup for Entendi plugin testing
set -euo pipefail

echo "=== Entendi Plugin Test Environment ==="

# Install Claude Code CLI
echo "Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code

# Install project dependencies
npm install

# Install the entendi plugin (fresh, like a new user would)
echo ""
echo "Installing entendi plugin..."
claude plugin install entendi

echo ""
echo "=== Setup complete ==="
echo ""
echo "To test as a fresh user:"
echo "  1. Run: claude"
echo "  2. Type: entendi login"
echo "  3. Check ~/.entendi/debug.log for hook activity"
echo ""
echo "To watch hook activity live:"
echo "  tail -f ~/.entendi/debug.log"
