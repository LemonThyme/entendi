# Entendi

Comprehension accountability for AI-assisted work.

> *"entendi"* -- Italian, from *intendere*: to understand.

## Why

Software engineering with LLMs moves faster than humans learn. Code assistants generate abstractions, design patterns, and infrastructure in seconds. Work that used to take days of learning now takes one prompt.

People stop understanding what they ship. Not on purpose, but when an LLM writes your Bayesian update function, sets up your CI pipeline, and deploys it all in one session, there's no pressure to understand any of it. Junior developers ship patterns they can't debug. Researchers use statistical methods they can't explain. The code works. The human didn't grow.

The solution isn't to slow down the AI. It's to make sure the human keeps up.

An engineer who understands the patterns an LLM uses can push it further, catch its mistakes, and make better decisions about what to build next. One who doesn't is a prompt typist sitting on technical debt they can't service.

## Who uses this

- Developers who want to learn from their AI pair programmer, not just delegate to it
- Engineering teams who need their people to understand what they're shipping
- Universities and bootcamps using LLMs in coursework and want learning accountability
- Research labs where understanding methodology matters
- Anyone who ships code all day with an LLM and feels like they learned nothing

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

1. **Detect** -- hooks and LLM analysis identify concepts from file paths, imports, code patterns, and conversation
2. **Decide** -- Bayesian mastery tracking decides if a probe makes sense given your knowledge profile
3. **Probe** -- a question gets asked naturally, scored on a 0-3 comprehension rubric
4. **Teach** -- low scores trigger a 4-phase Socratic tutor (assess, guide, correct, verify)
5. **Track** -- mastery updates go through a Graded Response Model with spaced repetition scheduling

## Install

```bash
claude plugin install entendi
```

Configure your API connection in `.claude/settings.local.json`:

```json
{
  "env": {
    "ENTENDI_API_URL": "https://entendi-api.tomaskorenblit.workers.dev",
    "ENTENDI_API_KEY": "your-api-key"
  }
}
```

Entendi activates automatically on every session after that.

## Stack

- TypeScript / Node 22 / Vitest (397 tests)
- Hono on Cloudflare Workers (also runs on Node)
- Drizzle ORM + Neon PostgreSQL
- Better Auth (API keys, orgs, sessions)
- MCP (Model Context Protocol) for Claude Code tool integration
- Claude Code Hooks (SessionStart, PostToolUse, UserPromptSubmit)

## Development

```bash
npm run api:dev        # Local API server (port 3456)
npm run build          # Build hooks, MCP server, plugin
npm test               # Run tests
npx wrangler deploy    # Deploy to Cloudflare Workers
```

Debug logs go to `~/.entendi/debug.log`.

## Roadmap

- [x] Bayesian mastery tracking (GRM + FSRS)
- [x] LLM-powered concept detection from code and conversation
- [x] 4-phase Socratic tutoring
- [x] Cloudflare Workers deployment
- [x] Plugin distribution via `claude plugin install`
- [ ] Multi-turn follow-up probes ([#1](https://github.com/LemonThyme/entendi/issues/1))
- [ ] Application-specific probes tied to codebase ([#2](https://github.com/LemonThyme/entendi/issues/2))
- [ ] Counterfactual tracking for gaming detection ([#3](https://github.com/LemonThyme/entendi/issues/3))
- [ ] Time-decayed surprise probes ([#4](https://github.com/LemonThyme/entendi/issues/4))
- [ ] Knowledge decay models grounded in cognitive science ([#5](https://github.com/LemonThyme/entendi/issues/5))
- [ ] Posterior variance for uncertainty-aware probing ([#6](https://github.com/LemonThyme/entendi/issues/6))

## License

MIT
