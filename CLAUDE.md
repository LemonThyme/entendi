# Entendi

Comprehension accountability layer for AI-assisted work.

## Tech Stack

TypeScript, Node 22+, Vitest, Hono, Better Auth, Drizzle ORM, Neon PostgreSQL, Cloudflare Workers, MCP server, Claude Code hooks + plugin

## Setup

```bash
git clone https://github.com/LemonThyme/entendi.git
cd entendi
npm install
cp .env.example .env   # fill in DATABASE_URL and BETTER_AUTH_SECRET
npm run build           # builds hooks, MCP server, plugin, dashboard assets
```

### Environment Variables

- `DATABASE_URL` — Neon PostgreSQL connection string (required)
- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32` (required)
- `BETTER_AUTH_URL` — API base URL, `http://localhost:3456` for local dev
- `ENTENDI_API_URL` — same as BETTER_AUTH_URL (used by hooks/MCP)

### Plugin Install

```bash
npm run build                     # must build first
claude plugin install entendi     # install as Claude Code plugin
```

After install, restart Claude Code. The plugin activates automatically (SessionStart injects the concept-detection skill, UserPromptSubmit handles state).

### Devcontainer

Open the repo in VS Code/Cursor with the Dev Containers extension for isolated plugin testing. Run `.devcontainer/test-plugin.sh` to validate hook behavior.

## Key Commands

```bash
npm run api:dev        # Local API server (port 3456)
npm run build          # Build hooks, MCP, plugin, dashboard
npm test               # Run tests
npx wrangler deploy    # Deploy to Cloudflare Workers
```

## Architecture

```
Claude Code ──► MCP Server (stdio) ──► HTTP API (Hono) ──► Neon PostgreSQL
                                         ▲
Dashboard (browser) ─────────────────────┘
```

**Hooks** (plugin/hooks/):
- `SessionStart` — injects concept-detection skill into every session
- `UserPromptSubmit` — handles login detection, pending probes, teach-me patterns

**MCP Tools**: `entendi_observe`, `entendi_record_evaluation`, `entendi_start_tutor`, `entendi_advance_tutor`, `entendi_dismiss`, `entendi_get_status`, `entendi_get_zpd_frontier`, `entendi_login`

**Concept Detection**: handled entirely by the concept-detection skill (LLM-level). No PostToolUse hook — the skill covers all detection with better context.

## Build Pipeline

`esbuild.config.ts` builds:
1. Hook JS bundles → `dist/hooks/`
2. MCP server bundle → `dist/mcp/`
3. Plugin assembly → `dist/plugin/` (clean build, copies from `plugin/` + built JS)
4. Dashboard assets → `public/assets/` (content-hashed, manifest generated)

The plugin installer reads from `dist/plugin/`. Always run `npm run build` before reinstalling.

## Debug Log

`~/.entendi/debug.log` — all hooks, MCP tools, and API calls logged here.

## Parallel Work

When the user says "parallel work", "spin up agents", or requests parallel execution, use **Claude Code Agent Teams** (not subagents). Create a team with teammates that own distinct file groups to avoid conflicts. Each teammate should get:
- Clear task assignments referencing the implementation plan
- Specific file ownership (no overlapping files between teammates)
- Instructions to commit after each task

Typical team structure: 3-4 teammates split by layer (API/core, dashboard UI, tests, infra).
