# Historical Analytics Design

## Overview

Add comprehensive historical analytics for individual users and organizations. Surface the rich event data Entendi already captures (assessment events, tutor sessions, probe tokens, dismissals, anomaly scores) through interactive visualizations and pre-computed aggregates.

## Goals

1. **Learning effectiveness** (foundation) — "Am I actually learning?" Mastery trends, tutor effectiveness, knowledge retention, learning velocity.
2. **Accountability & integrity** (differentiator) — "Is this person genuinely understanding?" Gaming detection, dismiss patterns, integrity scores, response quality trends.
3. **Discovery & planning** (forward-looking) — "What should I learn next?" Knowledge gaps, concept dependencies, ZPD evolution.

Both personal and org-level analytics are first-class.

## Visualization Approach

### Uncertainty Display

Raw Bayesian parameters (mu, sigma) are never exposed in the UI. Instead:

- **Charts**: Confidence band — line at mastery %, shaded area representing ±2σ clamped to 0–100%. Band narrows as more assessments happen. Tooltip: "Certainty range — narrows as you practice more."
- **Tables/compact views**: Range display — "65–85%" instead of "75%". Derived from mu ± 2σ.
- **Badges**: Confidence label (High/Med/Low) based on sigma thresholds (existing pattern).

### Charting Library

**Apache ECharts 6** — primary library for all chart types:
- Time-series with confidence bands (native stacked area)
- Radar/spider charts (native)
- Calendar heatmaps (native calendar coordinate system)
- Network/graph visualizations (native force layout)
- Built-in dark theme, tree-shakeable, vanilla JS compatible

If ECharts' force layout proves insufficient for the concept dependency graph, supplement with **Cytoscape.js**.

## New Database Tables

All tables are updated on-write (real-time, no cron) when assessment events are created.

### `daily_snapshots`

One row per user per day. Upserted on every assessment event.

| Column | Type | Description |
|--------|------|-------------|
| userId | text (FK) | |
| date | date | Calendar date |
| assessmentCount | integer | Total assessments that day |
| conceptsAssessed | integer | Distinct concepts assessed |
| avgMasteryDelta | real | Average mastery change |
| totalDismissals | integer | Dismissals that day |
| avgIntegrityScore | real | Average integrity score |
| probeCount | integer | Probe assessments |
| tutorCount | integer | Tutor assessments |
| domains | jsonb | Domain breakdown: `{ "typescript": 2, "react": 1 }` |

Primary key: `(userId, date)`. Index: `(userId, date DESC)`.

### `zpd_snapshots`

Inserted when a concept enters or exits the ZPD frontier after an assessment.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | |
| userId | text (FK) | |
| conceptId | text (FK) | |
| enteredAt | timestamp | When concept entered ZPD |
| exitedAt | timestamp | Nullable — when it left ZPD |
| masteryAtEntry | real | Mastery when entering ZPD |
| masteryAtExit | real | Nullable — mastery when leaving |

Index: `(userId, conceptId)`, `(userId, enteredAt DESC)`.

### `concept_analytics`

Per-user per-concept rollup. Upserted on every assessment event for that concept.

| Column | Type | Description |
|--------|------|-------------|
| userId | text (FK) | |
| conceptId | text (FK) | |
| firstAssessedAt | timestamp | First assessment ever |
| lastAssessedAt | timestamp | Most recent assessment |
| totalProbes | integer | Probe assessment count |
| totalTutorSessions | integer | Tutor session count |
| totalDismissals | integer | Total dismissals for this concept |
| peakMastery | real | Highest mu ever achieved |
| currentStreak | integer | Consecutive correct assessments |
| longestStreak | integer | Best streak ever |
| avgResponseWordCount | real | Average response word count |
| avgIntegrityScore | real | Average integrity score |

Primary key: `(userId, conceptId)`.

## New API Endpoints

All personal endpoints scoped to authenticated user. Org endpoints require org membership. Mastery values returned as `{ value, low, high }` (mu, mu-2σ, mu+2σ clamped) — no raw Bayesian parameters in responses.

### Personal Analytics

```
GET /analytics/timeline/:conceptId    Mastery + sigma over time (from assessment_events)
GET /analytics/timeline               All concepts aggregated (learning velocity)
GET /analytics/velocity               7d/30d/90d mastery gain rates
GET /analytics/activity-heatmap       Daily assessment counts (from daily_snapshots)
GET /analytics/retention              FSRS decay predictions per concept
GET /analytics/review-queue           Concepts predicted to drop below threshold
```

### Concept Deep-Dive

```
GET /analytics/concept/:conceptId     Full profile: timeline, events, tutor history, dismiss stats
```

### Integrity

```
GET /analytics/integrity/trends       Integrity score over time
GET /analytics/integrity/response-quality   Response feature trends
GET /analytics/dismiss-patterns       Dismiss rate per concept + over time
```

### Org Analytics (new)

```
GET /org/analytics/cohort             Member mastery distributions
GET /org/analytics/concept-heatmap    Member × concept mastery grid
GET /org/analytics/velocity           Per-member learning velocity
```

### Discovery

```
GET /analytics/dependency-graph       Concept edges with mastery overlay
GET /analytics/zpd-evolution          ZPD frontier snapshots over time
GET /analytics/knowledge-gaps/:target Prerequisites needed for target concept
```

## Dashboard Design

### Layout Principles

- **Fixed-layout with scroll containers** — every tab is a grid of fixed-height panels. Lists, tables, and charts live inside fixed-height containers with internal scroll areas. No page-level infinite scroll.
- **Skeleton placeholders** — loading states match exact panel dimensions. Nothing shifts during load.
- **User-scoped data only** — only concepts the user has interacted with (has a `user_concept_states` row) are shown. Unassessed concepts only appear contextually: as ghost nodes in dependency graphs, or in the ZPD frontier.

### Tab Structure

```
Overview | Analytics | Concepts | Integrity | Organization | Settings
```

### Analytics Tab — Personal Learning Story

**Stats strip** (fixed height): Current streak | Assessments this week | Avg mastery delta (7d) | Concepts mastered

**Activity heatmap** (panel, fixed height): GitHub-style calendar. Color intensity = assessment count per day. Source: `daily_snapshots`. Tooltips: "3 assessments, 2 concepts, avg +5% mastery."

**Learning velocity** (panel, fixed height): Area chart with confidence band. X = time, Y = cumulative mastery gain. Rolling 7d/30d/90d toggle. Source: `daily_snapshots.avgMasteryDelta`.

**Domain strength radar** (panel, fixed height): Spider chart across user's assessed domains. Each axis = domain average mastery. Source: `user_concept_states` grouped by `concepts.domain`.

**Retention alerts** (panel, fixed height, internal scroll): Card list of concepts predicted to decay below mastery threshold within 7 days (FSRS stability). Each card: concept name, current mastery range, predicted mastery in 7d, "Review" action.

### Concepts Tab — Explorer + Deep-Dives

**Concept table** (panel, internal scroll): Searchable, filterable by domain. Columns: Name, Domain, Mastery (65–85% range), Confidence (High/Med/Low), Assessments, Last Assessed, Trend arrow (up/down/flat from last 3 events). Source: `user_concept_states` + `concept_analytics`.

**Concept detail page** (click-through, replaces table):
- Mastery timeline with confidence band (mu ± 2σ). Assessment events as dots on line.
- Event log (scroll container): all assessments — type, score, mastery change, integrity, timestamp. Expandable rows for response text.
- Tutor history (scroll container): sessions with phase, scores, misconceptions. Expandable for exchanges.
- Dismiss history: count and timestamps.
- Prerequisites: mini dependency graph, this concept's prereqs color-coded by mastery. Unassessed prereqs as ghost nodes.

**Dependency graph** (sub-page): Interactive ECharts force layout. Nodes = user's concepts, edges = prerequisites. Node color = mastery (red → yellow → green). Node size = assessment count. Unassessed prereqs as ghost nodes. Click → concept detail. Filter by domain.

### Integrity Tab — Self-Monitoring

**Integrity trend** (panel): Line chart of composite anomaly score over time. Source: `anomaly_scores`.

**Response quality** (panel): Multi-line chart — word count, vocab complexity, formatting score trends. Source: `assessment_events.responseFeatures`.

**Dismiss patterns** (panel): Bar chart of dismiss count per concept + trend line of overall dismiss rate. Source: `dismissal_events` + `concept_analytics`.

**Probe funnel** (panel): Funnel chart — tokens issued → accepted → completed → scored. Source: `probe_tokens` lifecycle.

### Organization Tab — Enhanced

Existing features preserved. New panels:

**Cohort mastery distribution**: Histogram of members per mastery bucket (0-20%, 20-40%, etc.) for selected concept or all.

**Member × concept heatmap**: Grid — rows = members, columns = concepts (top 20 by breadth). Cell color = mastery.

**Team velocity**: Line chart of org-wide assessment activity and mastery gains. Source: aggregated `daily_snapshots`.

**Course progress**: Per-course completion bars for enrolled members. Source: `course_enrollments` + concept mastery.

## 20 Features — Prioritized Roadmap

### Tier 1: Learning Effectiveness (Foundation)

| # | Feature | Description |
|---|---------|-------------|
| 1 | Mastery Timeline Chart | Per-concept line chart with confidence band showing mastery over time |
| 2 | Learning Velocity Dashboard | Rate of mastery gain over 7d/30d/90d rolling windows |
| 3 | Concept Detail Page | Full concept profile: timeline, events, tutor history, dismissals, prereqs |
| 4 | User Profile / Concepts Tab | All user's concepts with mastery range, trends, search/filter |
| 5 | Tutor Effectiveness Report | Before/after mastery comparison: tutored vs. untutored assessments |
| 6 | Knowledge Retention Curves | FSRS stability visualization, predicted decay, review recommendations |
| 7 | Session Activity Heatmap | GitHub-style calendar heatmap of assessment activity |

### Tier 2: Accountability & Integrity (Differentiator)

| # | Feature | Description |
|---|---------|-------------|
| 8 | Integrity Score Dashboard | Per-user composite integrity trend over time |
| 9 | Response Quality Trends | Word count, formatting, vocab complexity over time |
| 10 | Dismiss Pattern Analytics | Per-concept dismiss rates and overall trend |
| 11 | Probe Acceptance Funnel | Token lifecycle: issued → accepted → completed → scored |
| 12 | Org Integrity Heatmap | Member × integrity matrix for team oversight |

### Tier 3: Discovery & Planning (Forward-Looking)

| # | Feature | Description |
|---|---------|-------------|
| 13 | Concept Dependency Graph | Interactive network visualization with mastery overlay |
| 14 | ZPD Evolution Timeline | Learning frontier movement over time |
| 15 | Knowledge Gap Analysis | Prerequisites needed for a target concept |
| 16 | Domain Strength Radar | Spider chart of mastery across domains |
| 17 | Recommended Review Queue | FSRS-predicted concepts due for review |

### Tier 4: Org & Comparative (Scale)

| # | Feature | Description |
|---|---------|-------------|
| 18 | Cohort Comparison | Mastery distributions across org members |
| 19 | Population Benchmarking | Percentile ranking vs. population statistics |
| 20 | Course Progress Tracker | Enrollment completion by module and concept |

### Phasing

| Phase | Features | Theme |
|-------|----------|-------|
| **v0.4a** | 1, 2, 3, 4, 7 | Core analytics — timelines, profiles, activity |
| **v0.4b** | 5, 6, 8, 9, 10 | Effectiveness + integrity signals |
| **v0.4c** | 11, 13, 16, 17 | Engagement funnels + discovery |
| **v0.5** | 12, 14, 15, 18, 19, 20 | Org scale + comparative + courses |

## Technical Decisions

- **ECharts 6** as sole charting library (tree-shaken import). Cytoscape.js only if ECharts force layout proves insufficient for dependency graph.
- **On-write materialization** — analytics tables updated inline during assessment event creation. No cron jobs, compatible with Cloudflare Workers.
- **API returns `{ value, low, high }`** for mastery — no mu/sigma in responses. UI never shows Bayesian terminology.
- **User-scoped** — only concepts with a `user_concept_states` row appear. Unassessed concepts shown only as ghost nodes in graphs or in ZPD frontier.
- **Fixed-layout panels** — no infinite scroll. All lists in scroll containers. Skeleton placeholders maintain dimensions during loading.
