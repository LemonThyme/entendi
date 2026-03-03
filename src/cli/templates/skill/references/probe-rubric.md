# Probe Evaluation Rubric

Detailed scoring criteria for `entendi_record_evaluation`. Score based on **demonstrated understanding**, not confidence or verbosity.

## Score 0 — No Understanding

The user provided no meaningful technical content.

**Examples:**
- "I don't know"
- "I'm not sure, can you explain?"
- Completely wrong answer (e.g., "React uses two-way data binding by default")
- Empty or nonsensical response
- Refusal to engage with the question

**Key indicator:** Nothing in the response demonstrates any knowledge of the concept.

## Score 1 — Surface-Level Understanding

The user shows awareness of the concept but lacks specific technical details.

**Examples:**
- "It's a way to manage state" (about Redux — correct but vague)
- "Promises are for async stuff" (correct direction, no specifics)
- "Docker containers are like virtual machines but lighter" (common analogy, no mechanism)
- "It helps with performance" (about memoization — too vague)

**Key indicator:** The user could have written this response from reading a single sentence description. No mechanisms, tradeoffs, or concrete details.

## Score 2 — Solid Understanding

The user demonstrates correct knowledge with specific technical details.

**Examples:**
- "useEffect runs after render and its cleanup function runs before the next effect or on unmount" (about React useEffect — names specific lifecycle behavior)
- "B-trees keep keys sorted and maintain balance by splitting nodes when they exceed a max fanout, which keeps lookup at O(log n)" (about B-trees — names mechanism and complexity)
- "CORS preflight sends an OPTIONS request first to check if the origin is allowed before the actual request" (about CORS — names the mechanism)
- "Thompson sampling maintains a Beta distribution per arm and samples from each to decide which to pull, naturally balancing exploration vs exploitation" (about Thompson sampling — names distribution and mechanism)

**Key indicator:** The user names specific mechanisms, tradeoffs, constraints, or concrete implementation details. They go beyond a dictionary definition.

## Score 3 — Deep Understanding

The user explains nuances, edge cases, design rationale, or connects to broader principles.

**Examples:**
- "useEffect's dependency array uses Object.is comparison, so passing objects or arrays as deps causes re-runs on every render since they're new references. You either need to memoize them or destructure primitives out." (about React useEffect — explains a subtle gotcha with concrete solution)
- "Raft uses term numbers to detect stale leaders — if a node receives a message with a higher term, it steps down. The key insight is that safety doesn't depend on timing, only liveness does." (about Raft consensus — explains design rationale and distinguishes safety from liveness)
- "Event sourcing gives you a complete audit trail and temporal queries for free, but the tradeoff is eventual consistency for read models and the complexity of handling schema evolution in events over time." (about event sourcing — names tradeoffs and long-term concerns)

**Key indicator:** The user demonstrates understanding that goes beyond textbook knowledge. They explain *why* things work the way they do, identify non-obvious tradeoffs, or demonstrate experience-based insight.

## Hard Rules

1. **Meta-commentary is not evidence.** Statements like "I understand this well", "I've used this a lot", or "This is basic" carry zero weight. Score based only on technical content.

2. **Confidence is not competence.** A confident wrong answer is still score 0. A hesitant correct answer with details is still score 2+.

3. **Use `evaluationCriteria` from the probe token.** The criteria specify what the user must demonstrate for this particular probe. If the criteria ask about tradeoffs and the user only explains the mechanism, cap at score 1.

4. **When in doubt, score lower.** Underestimating triggers a re-probe (low cost). Overestimating inflates mastery and skips future probes (high cost).

5. **Partial answers get partial credit.** If the user gets the mechanism right but the tradeoffs wrong, score 1-2 depending on depth of the correct portion.

6. **Verbosity is not depth.** A long response that repeats the same point in different ways is not score 3. Look for distinct, specific technical claims.

7. **Analogies alone are score 1.** "It's like a post office" doesn't demonstrate understanding of the actual mechanism. Analogies are fine as supplements but not as primary evidence.
