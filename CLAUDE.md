# Entendi

Comprehension accountability layer for AI-assisted work.

## Tech Stack

TypeScript, Node 22+, Vitest, Hono, Better Auth, Drizzle ORM, Neon PostgreSQL, Cloudflare Workers, MCP server, Claude Code hooks + plugin

## Key Commands

```bash
npm run api:dev        # Local API server (port 3456)
npm run build          # Build hooks, MCP, plugin
npm test               # Run tests
npx wrangler deploy    # Deploy to Cloudflare Workers
claude plugin install entendi  # Install plugin
```

## Debug Log

`~/.entendi/debug.log` — all hooks, MCP tools, and API calls logged here.
