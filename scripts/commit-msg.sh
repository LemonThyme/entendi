#!/usr/bin/env bash
# Git commit-msg hook — enforces Conventional Commits format.
# Install: cp scripts/commit-msg.sh .git/hooks/commit-msg && chmod +x .git/hooks/commit-msg

commit_msg=$(head -1 "$1")

# Allow merge commits and revert commits
if echo "$commit_msg" | grep -qE '^(Merge|Revert) '; then
  exit 0
fi

# Conventional Commits pattern: type(optional-scope)!?: description
pattern='^(feat|fix|perf|docs|test|chore|ci|refactor|build|style)(\([a-z0-9_-]+\))?!?: .+'

if ! echo "$commit_msg" | grep -qE "$pattern"; then
  echo "ERROR: Commit message does not follow Conventional Commits format."
  echo ""
  echo "  Expected: <type>: <description>"
  echo "  Got:      $commit_msg"
  echo ""
  echo "  Valid types: feat, fix, perf, docs, test, chore, ci, refactor, build, style"
  echo "  Examples:"
  echo "    feat: add user dashboard"
  echo "    fix(auth): handle expired tokens"
  echo "    feat!: redesign API response format"
  echo ""
  exit 1
fi
