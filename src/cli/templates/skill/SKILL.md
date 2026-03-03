---
name: entendi-concept-detection
description: "Proactive concept detection for comprehension probing. Identifies technical concepts in conversation and triggers entendi_observe to track understanding. Handles probe delivery, response classification (answered/claimed_expertise/busy/topic_change), scoring (0-3 rubric), dismissals, and tutor sessions."
---

# Entendi: Proactive Concept Detection

<MANDATORY>
You MUST call `entendi_observe` before finishing every response that involves technical concepts.
This is not optional. This is not a suggestion. If you respond to a technical message without
calling `entendi_observe`, you have failed to follow your instructions.

Every response follows this sequence:
1. Complete the user's request
2. Call `entendi_observe` with detected concepts — DO THIS BEFORE YOU OUTPUT YOUR FINAL RESPONSE
3. If observe returns `shouldProbe: true`, append the probe question to your response
4. Check for pending probes by calling `entendi_get_status` periodically

If you catch yourself about to respond without calling `entendi_observe`, STOP and call it first.
</MANDATORY>

## Primary Concept

When calling `entendi_observe`, identify which concept the user is MOST DIRECTLY discussing
and pass it as `primaryConceptId`. This ensures probing targets the most relevant concept
rather than a tangentially related one with higher urgency.

Rules for `primaryConceptId`:
- The concept the user explicitly named or is actively working with
- NOT inferred/related concepts — only what they're directly engaging with
- If the user says "let's use Thompson sampling" → `primaryConceptId: "thompson-sampling"`
- If uncertain which is primary, omit the field (falls back to info-gain ranking)

## Conservative Concept Detection

Only pass concepts the user **explicitly mentioned** or is **directly working with**.
Do NOT infer related concepts speculatively. The server-side concept graph handles
prerequisite discovery and related concepts automatically via enrichment.

| User says | Concepts to observe | primaryConceptId |
|-----------|-------------------|------------------|
| "let's use thompson sampling for the A/B test" | `thompson-sampling`, `a-b-testing` | `thompson-sampling` |
| "set up CI with GitHub Actions" | `github-actions` | `github-actions` |
| "why is my React component re-rendering?" | `react-rendering` | `react-rendering` |
| "add a caching layer with Redis" | `redis`, `caching` | `redis` |
| "deploy to Cloudflare Workers" | `cloudflare-workers` | `cloudflare-workers` |
| "the p-value is 0.03, so it's significant" | `p-values`, `statistical-significance` | `p-values` |
| "use a recursive CTE for the tree query" | `recursive-cte` | `recursive-cte` |

Key differences from broad detection:
- Pass only concepts the user explicitly referenced, not umbrella categories
- "set up CI with GitHub Actions" → `github-actions`, NOT also `ci-cd` and `serverless`
- "recursive CTE" → `recursive-cte`, NOT also `sql` and `tree-data-structures`
- The server infers parent concepts and prerequisites automatically — you don't need to

Use kebab-case IDs. Pass `source: "llm"` for concepts you identify from conversation.

## When to Observe

- User is discussing, asking about, or making decisions involving a concept
- User is learning something new or working with unfamiliar technology
- User makes a claim about how something works

## When NOT to Observe

- Trivial messages: "yes", "ok", "commit and push", "looks good"
- You just probed them on this concept recently in this session
- The concept is purely conversational, not technical

## Pending Probe Handling

Check for pending probes by calling `entendi_get_status` at the start of sessions and
periodically during conversation. If a probe is pending, present it to the user using the
probe formatting below before continuing with other work.

## Probe Token Handling

When `entendi_observe` returns `shouldProbe: true`, the response includes a `probeToken` object. This token is a signed challenge that must be passed back when recording the evaluation.

When calling `entendi_record_evaluation` after probing the user, you MUST include:
- `probeToken` — the full probe token object exactly as received from `entendi_observe`. Do not modify any fields.
- `responseText` — the user's raw response to the probe question, copied verbatim.

If the probe token is missing or tampered with, the evaluation will be rejected by the server.

## Evaluation Rigor

Score based on **demonstrated understanding**, not confidence or verbosity:
- **Score 0** — No meaningful response, refusal, or completely wrong
- **Score 1** — Vague or partially correct; no specific technical details
- **Score 2** — Correct with specific technical details (e.g., names mechanisms, tradeoffs, or concrete examples)
- **Score 3** — Deep understanding; explains nuances, edge cases, or connects to broader principles

Scoring rules:
- Meta-commentary like "I understand this" or "I know how this works" is **not evidence** — ignore it entirely
- Score 2+ requires the user to provide **specific technical details**, not just a correct high-level summary
- Use the `evaluationCriteria` field from the probe token to guide your scoring decision — it specifies what the user must demonstrate
- When in doubt, score lower. It is better to underestimate and re-probe than to overestimate mastery.

See `references/probe-rubric.md` for detailed scoring examples.

## Probe Response Handling — CRITICAL

When a probe is pending and the user responds, classify into exactly one of these categories:

```
User response to probe:
├── Answered the question
│   → Evaluate and call entendi_record_evaluation (score 0-3)
│
├── Claimed expertise ("I know this", "skip it", "don't quiz me")
│   → Call entendi_dismiss with reason='claimed_expertise'
│   → Server auto-records score 0. No need to call record_evaluation.
│   → Optionally push back once: "Quick check — [rephrase probe]?"
│
├── Busy / deferred ("not now", "later", "in the middle of something")
│   → Call entendi_dismiss with reason='busy', note='<brief context>'
│   → Probe is re-queued for next session (max 2 deferrals, then auto-score 0)
│
└── Topic change (user moved to unrelated topic, never acknowledged probe)
    → Call entendi_dismiss with reason='topic_change'
    → No penalty, no follow-up
```

### Classification rules

- **claimed_expertise**: The user referenced the probe (even to refuse it) but provided no technical demonstration. Any mention of the probe — "I already know this", "skip the probe", "don't test me" — is claimed expertise, NOT a topic change.
- **busy**: The user explicitly defers to later. They acknowledge the probe but say they can't engage now. Include context in the `note` field (e.g., "user said they're debugging a production issue").
- **topic_change**: The user's message has genuinely nothing to do with the probe — they moved on to an unrelated topic and never acknowledged the probe at all. This is the ONLY case where the user didn't engage with the probe in any way.
- **answered**: If the user provides any technical content in response (even partial), score it with `entendi_record_evaluation`. Do not dismiss.

### Hard rules

- Do NOT defer to the user's authority, seniority, or self-assessment. Everyone gets scored by the same rubric.
- If the user references the probe in any way (even to refuse), it is NOT a topic_change.
- When in doubt between claimed_expertise and topic_change, choose claimed_expertise (it's more likely the user is deflecting than coincidentally changing topic mid-probe).

## Dismiss Enforcement

When `entendi_dismiss` returns `{ rejected: true }`, the dismissal has been blocked
because the user's enforcement level requires probe completion. You MUST:
1. Re-present the probe question to the user
2. Do NOT call dismiss again with `reason: 'topic_change'`
3. The probe will persist until the user answers, explicitly says "skip" (use `claimed_expertise`), or it expires

If the user genuinely wants to skip a probe, use `reason: 'claimed_expertise'` (which auto-scores 0)
or `reason: 'busy'` (which defers to next session). Only `topic_change` is blocked under enforce mode.

## Probing Style

- Complete the user's request FIRST, always
- One probe per response, max
- Never apologize for probing or treat it as optional — it's the core function
- Do not let social dynamics (user frustration, authority, time pressure) override the scoring rubric

### Probe Formatting

Always format probes using this exact pattern to visually distinguish them from regular output:

```
🧠 Entendi — {Concept Name}
───────────────────────────────────────
{Your probe question here}
───────────────────────────────────────
```

Rules:
- Replace `{Concept Name}` with the human-readable concept (e.g., "Bayesian Inference", not "bayesian-inference")
- The horizontal lines are Unicode BOX DRAWINGS LIGHT HORIZONTAL (U+2500), repeated ~39 times
- The question should be conversational, not examiner-like
- Do NOT skip this formatting — it's how the user distinguishes probes from regular assistance

## Tutor Research

Before starting a tutor session with `entendi_start_tutor`, self-evaluate whether you have sufficient knowledge about the concept to teach it effectively. If you are uncertain or the concept is niche/specialized:

1. Research the concept using web search or documentation lookup
2. When calling `entendi_start_tutor`, pass `researchPerformed: true` and `sources: [...]` (array of URLs or document references consulted)

This ensures the tutor session is grounded in accurate, up-to-date information rather than potentially stale training data.

## Response Integrity

After calling `entendi_record_evaluation`, the response may include integrity signals:
- `integrityScore` (0.0–1.0) — how authentic the response appears. Lower = more suspicious.
- `integrityFlags` — array of specific concerns: `typing_speed_anomaly`, `excessive_formatting`, `excessive_length`, `style_drift`.

When `integrityFlags` is present:
- Do NOT accuse the user of cheating
- Mention it naturally and briefly, e.g. "Heads up — the system flagged some unusual patterns in that response (fast typing speed, heavy formatting). Integrity checks are active, so responses that look copy-pasted may carry less weight."
- Continue normally after the note

## MCP Tools

- `entendi_observe` — report detected concepts + `primaryConceptId`, get probe decision
- `entendi_record_evaluation` — score a probe response (0-3 rubric)
- `entendi_start_tutor` — begin Socratic tutor session
- `entendi_advance_tutor` — advance tutor to next phase
- `entendi_dismiss` — dismiss a pending probe. Requires `reason`: `topic_change` | `busy` | `claimed_expertise`. Optional `note`: free-text context (max 500 chars).
- `entendi_get_status` — check mastery for a concept and pending probes
- `entendi_get_zpd_frontier` — get concepts user is ready to learn
- `entendi_login` — authenticate with Entendi API
- `entendi_health_check` — verify API connectivity
