# Entendi architecture flow

What happens when Entendi decides to quiz you during a Claude Code session.

## Data flow

```
Claude Code (MCP client) → MCP server (local, stdio) → HTTP API (Hono) → Neon PostgreSQL
Hooks (PostToolUse / UserPromptSubmit) → HTTP API → Neon PostgreSQL
```

## Probe lifecycle

### 1. Session start

Claude Code opens in an Entendi project. The `session-start` hook fires and injects the `concept-detection` skill, which tells Claude to watch for technical concepts in conversation.

### 2. Normal work

You ask questions, write code, whatever. Claude identifies technical concepts you're touching — `recursive-cte`, `bayesian-updating`, that sort of thing.

### 3. `entendi_observe` (MCP)

Claude calls `entendi_observe` with the detected concepts and a `primaryConceptId`. The MCP server forwards this as a POST to the Hono API (`/api/mcp/observe`), which looks up your `user_concept_states` row: mastery, sigma, last assessment, urgency.

### 4. Probe decision

The API checks whether to probe based on your Bayesian mastery level, FSRS scheduling, and urgency score.

If yes, it issues an HMAC-signed probe token: single-use, 30-minute TTL, bound to your userId and conceptId. Returns `shouldProbe: true` to Claude.

### 5. The question

Claude slips a question into its response. "By the way, how does X work under the hood?" You don't see any plumbing behind this.

### 6. You respond

You answer. Or don't.

### 7. `UserPromptSubmit` hook

Before Claude sees your message, the `UserPromptSubmit` hook fires. It hits the API to check for pending actions (`/api/mcp/pending-action`). If a probe is pending, the hook injects evaluation instructions into Claude's context.

### 8. `entendi_record_evaluation` (MCP)

Claude scores your response on a 0-3 rubric:

- 0 — no meaningful response, or wrong
- 1 — vague, partially correct, no specifics
- 2 — correct with specific technical details
- 3 — deep understanding, explains nuances or edge cases

Claude sends back the probe token and your raw text. The MCP server forwards to the API, which validates the token (HMAC signature, expiry, nonce, userId, conceptId) and updates your mastery in `user_concept_states`.

### 9. Tutor offer

If you scored low, the API creates a `tutor_offered` pending action. Next hook cycle, Claude gets instructions to offer a 4-phase Socratic tutor session.

## Probe token security

The token is signed and single-use. Without this:

- You could replay a previous high-scoring evaluation.
- The LLM could fabricate a probe that was never issued.
- Since the LLM both asks and scores, there'd be no way to verify the server actually issued the challenge.

Signature payload: `${tokenId}:${userId}:${conceptId}:${depth}:${issuedAt}:${expiresAt}`

## Response integrity detection

Two things stop you from gaming the knowledge graph.

### Per-response scoring

When you submit a probe response, the system pulls behavioral signals from the raw text and computes an `integrityScore` (0.0-1.0):

| Signal | Threshold | Max penalty | Why |
|--------|-----------|-------------|-----|
| Typing speed | > 15 chars/sec | 60% | Humans type ~5-8 cps. Faster is probably paste. |
| Formatting density | > 3 markdown elements | 40% | `**bold**` and `- bullets` in chat? Probably not typed by hand. |
| Response length | > 150 words | 30% | Probe answers should be short. |
| Style drift | 2+ signals off baseline | 30% | Your word count jumped 3x, or typing speed 2.5x your average. |

Style baseline is an exponential moving average (EMA, alpha=0.3) per user in `responseProfiles`. It adapts, so fast typers don't get permanently flagged.

If `integrityScore` drops below 0.5, the Bayesian mastery update gets scaled by the score. A 0.3 integrity score means the response moves your mastery only 30% as far.

### Population-level anomaly detection

Z-scores across four dimensions, weighted into a composite:

| Signal | Weight | What it catches |
|--------|--------|-----------------|
| `z_self` | 30% | Your recent scores vs your own history |
| `z_population` | 30% | Your scores vs everyone else on the same concept |
| `dismissRatio` | 20% | How often you dismiss probes without answering |
| `masteryVelocity` | 20% | How fast your mastery climbs vs the population |

Only positive deviations get flagged. Scoring lower than peers isn't suspicious.

The server doesn't decide you're cheating. It measures, flags outliers, and dampens suspicious updates mechanically. Referee, not judge.

## Tables

| Table | What's in it |
|-------|-------------|
| `user_concept_states` | Mastery estimate per user per concept |
| `assessment_events` | Every probe and tutor evaluation |
| `probe_tokens` | Issued tokens, nonces for single-use enforcement |
| `pending_actions` | Queued actions for hook injection |
| `tutor_sessions` | Active and completed tutor sessions |
| `tutor_exchanges` | Individual tutor phase exchanges |
| `dismissal_events` | Every dismissed probe, for audit |
| `anomaly_scores` | Z-score results |
| `responseProfiles` | Per-user EMA baseline for style drift |
