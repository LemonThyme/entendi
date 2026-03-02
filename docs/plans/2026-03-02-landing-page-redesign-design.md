# Landing page redesign

**Date**: 2026-03-02
**Status**: Approved

## Problem

The current landing page has a "demo gif coming soon" placeholder, a waitlist form for a product that's already live, and copy that describes features ("Bayesian knowledge graph") instead of outcomes. It speaks to individual developers but not to engineering teams or universities, both of which are target audiences.

## Goals

1. Replace the waitlist with a direct install command
2. Add a real terminal recording demo
3. Write copy that lands with solo devs, engineering managers, and university instructors
4. Keep the existing warm design system (Source Serif 4 + DM Sans, earth tones)
5. All copy passes the humanizer audit (no AI writing patterns)

## Design

### Nav

Same as current: entendi | press | contact | sign in

On `api.entendi.dev`, links point to `https://entendi.dev/*`.

### Hero

**Headline** (Source Serif 4, ~2.25rem, 700 weight):

> Actually understand what your AI writes.

**Subtitle** (DM Sans, 0.95rem, secondary color):

> An open-source Claude Code plugin. It watches what you build with AI and checks that you get it.

**Install CTA** (monospace, accent background, copy-to-clipboard button):

```
claude plugin install entendi
```

**Below CTA** (small text, tertiary color):

> Free. Open source. Takes 30 seconds.

### Demo

Asciinema terminal recording converted to a format suitable for web embedding. Centered, max-width 640px, border-radius 8px, autoplay muted loop.

**Recording script** (~12-15 seconds):
1. User prompt: asks Claude to implement something (e.g., "add rate limiting to the API")
2. Claude writes code (fast-forward through this, 2-3 seconds)
3. Entendi probe appears with the branded block format
4. User types a short answer
5. Score acknowledged, conversation continues

The demo replaces the current `<div class="demo-placeholder">demo gif coming soon</div>`.

The demo recording is a separate task. It requires an actual Claude Code session with Entendi active, recorded with asciinema or a screen recording tool. The landing page implementation should support both an embedded asciinema player and a fallback GIF/video element.

### Audience blocks

Three blocks below the fold, stacked vertically. Each has a short bold label and a paragraph. They are intentionally NOT parallel in structure.

**Block 1 — "You"**

> You've accepted a hundred AI suggestions today. How many could you explain to someone? Entendi asks you about the concepts you're working with. Not every time. Just often enough that you notice what you actually know vs what you're trusting the machine on.

**Block 2 — "Your team"**

> When someone on your team ships a feature they built with AI, do they understand the code well enough to debug it at 2am when something breaks? Entendi tracks what each engineer understands across the codebase. You see the gaps before they hit production.

**Block 3 — "Your students"**

> Students are submitting AI-generated code. You know it. They know it. Banning AI isn't realistic and doesn't teach anything. Entendi sits inside the coding environment and asks questions as they work. Not a plagiarism detector. A tutor.

### How it works

Four numbered steps, plain text, no icons:

1. You code with Claude like normal
2. Entendi watches the technical concepts that come up
3. When something's worth checking, it asks you a question
4. Your answers build a knowledge profile over time

### Bottom CTA

Same install command as hero, repeated:

```
claude plugin install entendi
```

> Open source on GitHub. Free for individuals. Team and university plans coming.

### What gets removed

- Waitlist form and `/api/waitlist` endpoint references (keep the endpoint alive for existing signups, just remove from the page)
- "demo gif coming soon" placeholder
- Feature bullets ("Observes concepts...", "Probes your understanding...", "Builds a Bayesian knowledge graph...")

## Visual design notes

- Keep the current design system: `--bg: #F6F4F1`, `--accent: #C4704B`, `--font-display: Source Serif 4`, `--font-body: DM Sans`
- The install command block uses monospace font, `--bg-card` background, `--accent` left border or accent background with white text
- Audience blocks use the existing `--bg-card` card style with subtle borders
- The layout stays centered, max-width ~700px, with generous vertical spacing between sections
- No dark mode switch needed — keep the warm light theme that distinguishes Entendi from the "Linear dark glassmorphism" trend. The warmth is part of the brand (learning, not surveillance).

## Copy principles (humanizer rules)

- No em dashes (use commas or periods)
- No rule-of-three constructions
- No negative parallelisms ("not X, but Y")
- No copula avoidance ("serves as", "stands as")
- No promotional language ("groundbreaking", "revolutionary")
- Vary sentence length and structure
- Write like a person talking, not a brochure

## Files to modify

| File | Change |
|------|--------|
| `src/api/routes/dashboard.ts` | Replace `getLandingHTML()` with new hero, demo, audience blocks, how-it-works, bottom CTA |
| `src/dashboard/dashboard.css` | Add styles for install command block, audience cards, how-it-works section (or inline in dashboard.ts) |
| `public/` | Add demo recording asset (asciinema JSON, GIF, or video) |

## Demo recording (separate task)

The terminal recording needs to be created from an actual Entendi session. Options:

1. **asciinema** — record a real session, host the JSON, embed with asciinema-player JS
2. **Screen recording → GIF** — record with a tool, convert to optimized GIF with gifski
3. **Screen recording → MP4** — record, compress, use `<video autoplay muted loop>`

Recommendation: start with a screen recording converted to MP4 (most control over pacing, smallest file size, universal browser support). Embed with `<video autoplay muted loop playsinline>`.

The recording script should be rehearsed so the pacing looks natural. Fast-forward through Claude's code generation (nobody needs to watch an LLM type), slow down on the probe and user answer.
