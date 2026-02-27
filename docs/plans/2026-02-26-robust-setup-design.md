# Robust Setup — Design

**Date:** 2026-02-26
**Problem:** Plugin cache causes stale versions after code changes. Users (like Lara) get stuck on old cached builds with no clear error. Setup has multiple failure points with no validation.

## Root Cause

`plugin.json` has a hardcoded version (`0.1.0`). Claude Code caches plugins by version under `~/.claude/plugins/cache/entendi/entendi/0.1.0/`. When code changes but the version doesn't bump, `claude plugin install` silently serves the stale cached copy. The workaround (`rm -rf ~/.claude/plugins/cache/entendi`) is manual and undiscoverable.

## Solution

### 1. Build-time version stamping

During `npm run build`, `esbuild.config.ts` overwrites `dist/plugin/.claude-plugin/plugin.json` with version `0.1.0+<git-short-hash>`. Every build produces a unique version, busting the cache automatically. No manual cache clearing needed.

### 2. `setup.sh` — single-command setup

A script at repo root that validates the full setup pipeline:

1. **Check Node >= 22** — fail with clear message
2. **Check `.env` exists** — copy from `.env.example` if missing, tell user to fill it in, exit
3. **Validate required env vars** — `DATABASE_URL` and `BETTER_AUTH_SECRET` must be non-placeholder
4. **Run `npm install`**
5. **Run `npm run build`** (stamps version)
6. **Clear plugin cache** — `rm -rf ~/.claude/plugins/cache/entendi`
7. **Run `claude plugin install entendi`**
8. **Print success** with next steps

Every step prints status. Failures give actionable messages.

### 3. Hardened `plugin:reinstall`

Existing npm script (`build + rm cache + install`) stays. Build now stamps version, so even without manual cache clear, new versions bust through.

### 4. README update

Simplify setup sections to point at `setup.sh` as the primary path.

## Out of Scope

- npm publishing / `npx entendi-setup` CLI (YAGNI)
- `postinstall` npm hook (annoying for test-only contributors)
- DB connectivity check in setup (API server fails clearly on bad DB)
- Auto-update / version mismatch detection
