# Entendi

Comprehension accountability for AI-assisted work.

> *"entendí"* — "I understood" in Italian and Spanish, from *intendere*.

## Why

Software engineering with LLMs moves faster than humans learn. Code assistants generate abstractions, design patterns, and infrastructure in seconds. Work that used to take days of learning now takes one prompt.

People stop understanding what they ship. Not on purpose, but when an LLM writes your Bayesian update function, sets up your CI pipeline, and deploys it all in one session, there's no pressure to understand any of it. Junior developers ship patterns they can't debug. Researchers use statistical methods they can't explain. The code works. The human didn't grow.

The solution isn't to slow down the AI. It's to make sure the human keeps up.

## How it works

Entendi runs as a [Claude Code](https://claude.com/claude-code) plugin. It watches your coding session, identifies technical concepts from your code and conversation, and checks whether you understand them.

```
You: "deploy to Cloudflare Workers"

Claude: [completes the deployment]
        "By the way, Workers run on V8 isolates, not containers.
         How does that affect what Node APIs you can use?"

You: "I'm not sure"

Claude: [offers a Socratic tutor session]
        "Let's work through it. What runtime does Node.js normally use,
         and why would V8 isolates be different?"
```

It finishes your request first, then asks. If you know the material, it leaves you alone. If you don't, it teaches you.

### Pipeline

1. **Detect** — LLM-level concept detection identifies what you're working with from conversation context
2. **Decide** — Bayesian mastery tracking decides if a probe makes sense given your knowledge profile
3. **Probe** — a question gets woven in naturally, scored on a 0–3 comprehension rubric
4. **Teach** — low scores trigger a 4-phase Socratic tutor (assess, guide, correct, verify)
5. **Track** — mastery updates go through a Graded Response Model with spaced repetition scheduling

## Install

### 1. Install the plugin

```bash
claude plugin install entendi
```

### 2. Link your account

Inside any Claude Code session:

```
You: "entendi login"
```

This opens a browser window. Sign in (or create an account), click **Confirm Link**, and tell Claude you're done. Your API key is saved to `~/.entendi/config.json` automatically.

### 3. Restart Claude Code

```bash
claude
```

Entendi activates automatically on every session after that. You'll see concept detection in action as you work.

## Dashboard

View your knowledge profile at:

```
https://entendi-api.tomaskorenblit.workers.dev
```

Sign in with the same account you used during `entendi login`.

## Stack

- TypeScript / Node 22 / Vitest
- Hono on Cloudflare Workers
- Drizzle ORM + Neon PostgreSQL
- Better Auth (email/password, API keys, orgs)
- MCP (Model Context Protocol) for Claude Code tool integration
- Claude Code Hooks (SessionStart, UserPromptSubmit)

## Development

```bash
git clone https://github.com/LemonThyme/entendi.git
cd entendi
npm install
cp .env.example .env   # fill in DATABASE_URL and BETTER_AUTH_SECRET
npm run build           # build hooks, MCP server, plugin, dashboard assets
npm run api:dev         # local API server (port 3456)
npm test                # run tests
```

### Plugin Development

After making changes to hooks or MCP server:

```bash
npm run build                     # rebuild everything
claude plugin install entendi     # reinstall (reads from dist/plugin/)
```

If the plugin cache is stale, clear it first:

```bash
rm -rf ~/.claude/plugins/cache/entendi
claude plugin install entendi
```

### Devcontainer

For isolated plugin testing (simulates a fresh user):

1. Open the repo in VS Code/Cursor with the Dev Containers extension
2. The container installs Node 22, Claude Code CLI, and the plugin automatically
3. Run `.devcontainer/test-plugin.sh` to validate hooks and plugin structure

### Deploy

```bash
npx wrangler deploy    # deploy API to Cloudflare Workers
```

### Debug

All hooks, MCP tools, and API calls log to `~/.entendi/debug.log`.

## License

MIT
