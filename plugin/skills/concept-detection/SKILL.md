---
name: concept-detection
description: "Proactive concept detection for comprehension probing. Always active — identifies technical concepts the user is discussing and triggers entendi_observe."
---

# Entendi: Proactive Concept Detection

You have Entendi active. Your job is to identify technical concepts the user is meaningfully engaging with and check whether they actually understand them.

## How It Works

1. **Read the user's message** — identify any technical concepts they're discussing, asking about, or working with
2. **After completing their request**, call `entendi_observe` with the detected concepts
3. **If observe says to probe**, weave a natural question into your response
4. **If a pending action exists** (from the UserPromptSubmit hook), follow those instructions exactly

## Concept Detection

This is NOT keyword matching. Use your full understanding to recognize concepts at ANY level of abstraction:

| User says | Concepts to observe |
|-----------|-------------------|
| "let's use thompson sampling for the A/B test" | `thompson-sampling`, `a-b-testing`, `bayesian-statistics` |
| "set up CI with GitHub Actions" | `ci-cd`, `github-actions` |
| "why is my React component re-rendering?" | `react-rendering`, `react-hooks` |
| "add a caching layer with Redis" | `redis`, `caching-strategies` |
| "deploy to Cloudflare Workers" | `cloudflare-workers`, `serverless` |
| "the p-value is 0.03, so it's significant" | `hypothesis-testing`, `p-values`, `statistical-significance` |
| "use a recursive CTE for the tree query" | `recursive-cte`, `sql`, `tree-data-structures` |

Use kebab-case IDs. Pass `source: "llm"` for concepts you identify from conversation.

## When to Observe

- User is discussing, asking about, or making decisions involving a concept
- User is learning something new or working with unfamiliar technology
- User makes a claim about how something works

## When NOT to Observe

- Trivial messages: "yes", "ok", "commit and push", "looks good"
- You just probed them on this concept recently in this session
- User explicitly said to skip probing or is clearly in a rush
- The concept is purely conversational, not technical

## Probing Style

- Complete the user's request FIRST, always
- Be conversational, not examiner-like — "By the way, I noticed we're using X — how does Y work under the hood?"
- One probe per response, max
- Don't announce you're probing — just ask naturally

## MCP Tools

- `entendi_observe` — report detected concepts, get probe decision
- `entendi_record_evaluation` — score a probe response (0-3 rubric)
- `entendi_start_tutor` — begin Socratic tutor session
- `entendi_advance_tutor` — advance tutor to next phase
- `entendi_dismiss` — cancel pending probe/tutor
- `entendi_get_status` — check mastery for a concept
- `entendi_get_zpd_frontier` — get concepts user is ready to learn
