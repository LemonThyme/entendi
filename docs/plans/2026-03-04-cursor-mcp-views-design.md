# Cursor MCP Apps Views — Design

**Date:** 2026-03-04
**Status:** Approved

## Principle

All views are **display cards**. They show data beautifully and receive updates via `ontoolresult`. User interaction (answering probes, starting tutors) happens in the normal chat input. Views trigger actions via `sendMessage` to inject prompts into the conversation.

No competing input fields. No form state. No submit buttons. The view's job is to **show** and **react**, not to capture input.

## Views

### 1. Probe Card

**Resource:** `ui://entendi/probe`
**Trigger:** `entendi_observe` returns `shouldProbe: true`
**Purpose:** Display the probe question with context, then show the result after evaluation.

#### Before Answer

```
┌─────────────────────────────────────┐
│  REDIS CACHING                      │
│  ████████░░░░░░░░░ 34%  ↓ decaying  │
│                                     │
│  "How does Redis handle cache       │
│   invalidation when using a         │
│   pub/sub pattern?"                 │
│                                     │
│  ⚡ Last probed 14 days ago          │
│     Seen 3× this week               │
└─────────────────────────────────────┘
```

Elements:
- **Concept name** — uppercase, prominent
- **Mastery bar** — current percentage with color coding (green ≥70%, orange ≥40%, red <40%)
- **Decay indicator** — "↓ decaying" if stability predicts mastery will drop, "↑ improving" if recent positive trend, or blank if stable
- **Question** — the probe question, typeset for readability
- **Context line** — why this probe: last probed X days ago, seen N× this week

#### After Answer (via ontoolresult from record_evaluation)

```
┌─────────────────────────────────────┐
│  REDIS CACHING                      │
│  ████████████░░░░░ 52%  ↑ +18%     │
│                                     │
│  Confidence: ██████████░ narrowing   │
│  Next review: ~8 days               │
└─────────────────────────────────────┘
```

Elements:
- **Animated mastery bar** — slides from old% to new%
- **Delta badge** — "+18%" or "-5%" with color
- **Confidence indicator** — sigma visualized as a bar (wide = uncertain, narrow = confident)
- **Next review** — estimated days until next probe based on FSRS stability

#### Data Requirements

From `observe` response (already available):
- `conceptId`, `probeQuestion`, `mastery`, `urgency`, `depth`

Need to add to observe response:
- `lastAssessedDays` — days since last assessment (computed from `lastAssessed`)
- `assessmentCount` — how many times probed
- `stability` — FSRS stability value for next-review estimate

From `record_evaluation` response (already available):
- `mastery`, `previousMastery`, `sigma`, `previousSigma`

Need to add:
- `stabilityDays` — predicted days until 90% recall drops to threshold

### 2. Mastery Overview

**Resource:** `ui://entendi/status`
**Trigger:** `entendi_get_status` called
**Purpose:** Show all assessed concepts with mastery and uncertainty at a glance.

#### Layout

```
┌─────────────────────────────────────┐
│  Mastery  ↑ +8% this week          │
│                                     │
│  react hooks    ████████████░ 72%   │
│                 ┊        ▓▓▓┊       │
│  redis caching  █████░░░░░░░ 34%   │
│                 ┊  ▓▓▓▓▓▓▓▓┊       │
│  sql joins      ██████████░░ 61%   │
│                 ┊      ▓▓▓▓┊       │
│                                     │
│  9 concepts · 0 mastered · 3 weak   │
└─────────────────────────────────────┘
```

Elements:
- **Header** — "Mastery" + weekly velocity (net mastery delta across all concepts)
- **Concept rows** — sorted by urgency (what needs attention first)
  - Concept name (kebab-case → readable)
  - Mastery bar with percentage
  - Sigma overlay — translucent range behind the bar showing uncertainty width
  - Urgency-based color: decaying concepts get warm tones, stable concepts neutral
- **Footer** — summary counts: total concepts, mastered, weak

#### Data Requirements

Already available from status endpoint:
- `concepts[]` with `id`, `mu`, `sigma`, `assessmentCount`, `lastAssessed`

Need to add:
- `urgency` per concept — computed from probe-urgency formula
- `weeklyDelta` — aggregate mastery change this week (from dailySnapshots or computed)
- `stability` per concept — for decay indication

### 3. Learning Frontier

**Resource:** `ui://entendi/frontier`
**Trigger:** `entendi_get_zpd_frontier` called
**Purpose:** Show concepts the user is ready to learn next. Menu, not dashboard.

#### Layout

```
┌─────────────────────────────────────┐
│  Ready to Learn                     │
│                                     │
│  async iterators                    │
│  Prerequisites met · High info-gain │
│  [Start Learning →]                 │
│                                     │
│  web workers                        │
│  Prerequisites met · Medium gain    │
│  [Start Learning →]                 │
│                                     │
│  3 more concepts available          │
└─────────────────────────────────────┘
```

Elements:
- **Concept cards** — top 3-5 by readiness
  - Concept name
  - Readiness indicator: "Prerequisites met" or "2 of 3 prerequisites met"
  - Information gain level: High/Medium/Low (based on Fisher info at current mu)
  - "Start Learning" button — calls `sendMessage` to inject "Teach me about {concept}" into chat
- **Footer** — count of additional available concepts

#### Data Requirements

Current API returns: `conceptId`, `domain`, `mastery`, `assessmentCount`, `fisherInfo`

Need to add:
- `prerequisitesMet` — boolean or "X of Y met"
- `readiness` — 0-1 score combining prerequisite mastery and info-gain potential
- Sort by readiness descending

## Styling

### Color System
```css
--mastery-strong: light-dark(#2D7D46, #4CAF6A);   /* ≥70% */
--mastery-growing: light-dark(#C4704B, #D4845F);   /* ≥40% */
--mastery-weak: light-dark(#B54040, #D45050);       /* <40% */
--sigma-overlay: rgba(128, 128, 128, 0.15);
--delta-positive: light-dark(#2D7D46, #4CAF6A);
--delta-negative: light-dark(#B54040, #D45050);
```

### Typography
- Concept names: system font, 13px, medium weight
- Percentages: system font, 12px, semibold, monospace-numeric
- Question text: system font, 14px, normal weight, 1.5 line-height
- Context/meta text: system font, 11px, normal weight, secondary color

### Layout Constraints
- Max width: determined by Cursor's container (typically 300-400px)
- Views should be compact — no scrolling if possible
- Respect `containerDimensions` from host context

## Implementation Notes

### Mastery Animation
When `ontoolresult` delivers a `record_evaluation` result with `previousMastery` and `mastery`:
1. CSS transition on the bar width (300ms ease-out)
2. Number counter animates from old to new (requestAnimationFrame)
3. Delta badge fades in after bar finishes

### Sigma Visualization
Convert sigma (0.05–1.5) to a visual range:
- `rangePct = pMastery(mu + 2*sigma) - pMastery(mu - 2*sigma)` (95% confidence interval in mastery space)
- Render as translucent bar behind the mastery fill

### View Updates
- Views register `onToolResult` handlers for their relevant tool results
- Probe card listens for both `observe` (to show question) and `record_evaluation` (to show result)
- Status view re-fetches data via `callServerTool` on init
- Frontier view fetches via `callServerTool` on init

### sendMessage for Actions
Frontier "Start Learning" button:
```js
EntendiApp.sendMessage({
  role: 'user',
  content: [{ type: 'text', text: 'Teach me about async-iterators' }]
});
```
This injects the message into chat, triggering the tutor flow naturally.
