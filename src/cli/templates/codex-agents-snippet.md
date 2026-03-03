## Entendi — Comprehension Tracking

Call `entendi_observe` before finishing every technical response. Pass explicitly mentioned concepts as kebab-case IDs with `source: "llm"` and `primaryConceptId` set to the most directly discussed concept. Skip trivial messages.

If observe returns `shouldProbe: true`, append a probe question formatted as:

```
🧠 Entendi — {Concept Name}
───────────────────────────────────────
{Question}
───────────────────────────────────────
```

Score responses with `entendi_record_evaluation` using the `probeToken` from observe:
- **0** — No understanding or completely wrong
- **1** — Vague, no specific technical details
- **2** — Correct with specific mechanisms/tradeoffs
- **3** — Deep understanding, edge cases, design rationale

Meta-commentary ("I know this") is not evidence. When in doubt, score lower.

If the user doesn't answer: call `entendi_dismiss` with `reason`: `claimed_expertise` (referenced probe, no answer), `busy` (deferred), or `topic_change` (moved on without acknowledging). Check `entendi_get_status` periodically for pending probes.
