# Dashboard Redesign — Design

**Date:** 2026-02-27
**Goal:** Full visual overhaul of the Entendi dashboard. Unified design system across all 6 tabs with warm academic personality. Every tab gets beautiful care.

## Design System — Palette C: Stone + Terracotta

### Typography
- **Display/headings:** Source Serif 4 (SemiBold 600, Bold 700)
- **Body/data/labels:** DM Sans (Regular 400, Medium 500)
- **Monospace:** existing stack (SF Mono, Cascadia Code, Fira Code, JetBrains Mono)

### Type Scale
| Role | Font | Weight | Size | Color |
|------|------|--------|------|-------|
| Page title | Source Serif 4 | 600 | 22px | #1F1F1F |
| Section header | Source Serif 4 | 600 | 18px | #1F1F1F |
| Subsection header | Source Serif 4 | 600 | 16px | #1F1F1F |
| Body text | DM Sans | 400 | 14px | #1F1F1F |
| Data/table | DM Sans | 500 | 13px | #1F1F1F |
| Label (uppercase) | DM Sans | 400 | 11px, 0.05em tracking | #9B9389 |
| Caption/meta | DM Sans | 400 | 12px | #7A7268 |

### Color Palette
| Role | Hex | Usage |
|------|-----|-------|
| Background | #F6F4F1 | Page background |
| Card surface | #EDEAE5 | Card/panel backgrounds |
| Border | #E0DCD6 | Dividers, borders |
| Text primary | #1F1F1F | Headings, body text |
| Text secondary | #7A7268 | Descriptions, metadata |
| Text tertiary | #9B9389 | Labels, placeholders, inactive tabs |
| Accent (terracotta) | #C4704B | Active tab, primary buttons, links |
| Success (sage) | #5B7B5E | Mastered concepts, positive indicators |
| Warning (gold) | #B8860B | In-progress, medium confidence |
| Error (brick) | #B84233 | Low mastery, alerts, destructive actions |

### Spacing
- Section gaps: 32px
- Group gaps: 16px
- Element gaps: 8px
- Page padding: 28px horizontal

### Components
- **Corner radius:** 8px cards, 4px badges/bars
- **Container style:** Background differentiation ONLY. No strokes or shadows on cards.
- **Active tab:** Terracotta 2px bottom border + terracotta text
- **Inactive tab:** #9B9389 text, no border
- **Mastery bars:** 6px height, 4px radius, colored by mastery level
- **Buttons:** Terracotta fill for primary, stone fill for secondary
- **Toggles:** Terracotta when on, stone when off
- **Empty states:** Source Serif 4 italic, secondary color, centered
- **Loading skeletons:** Card surface color pulsing
- **Toasts:** Terracotta background, white text

## Tab Designs

### Overview — "What should I care about right now?"

No stat cards. Two hero panels side by side:

**Left: "Strongest"**
- Top 3 concepts by mastery
- Each: concept name, mastery %, small trend indicator (arrow up/down/flat)
- Sage green mastery bars

**Right: "Needs Attention"**
- Bottom 3 concepts by mastery (or decaying ones)
- Each: concept name, mastery %, time since last assessed
- Brick red mastery bars

**Below: "Recent Activity"**
- Last 5-7 events as compact timeline (not a table)
- Each entry: concept name, event type (probe/tutor), score, relative time
- Mastery delta inline (not separate columns)

Three things total. Best, worst, recent.

### Analytics

**Hero:** Full-width activity heatmap calendar. The heatmap IS the entry point.

**Below (two panels side by side):**
- Learning Velocity — line chart, period toggle (7d/30d/90d) in section header
- Domain Strengths — radar chart

**Bottom:** "Review Needed" — concepts predicted to decay, compact list

### Concepts

**Filter bar** at top (domain tags as pills).

**Concept list:** Scrollable, each row: concept name, domain badge, mastery bar, confidence badge, assessment count. Consistent row height and column alignment.

**Concept Detail** (click to expand): Full-width takeover with back button. Mastery timeline chart with confidence bands, prerequisite tree, tutor session history.

### Integrity

**Hero:** Large integrity trend chart (z-score over time).
**Below:** Dismiss patterns chart.

Charts use warm palette colors (terracotta for anomaly, sage for normal).

### Organization

**Org switcher** in header area.

- Members list — clean table with name, role, average mastery inline bar
- Rankings — leaderboard style
- Pending Invites — compact with terracotta action buttons

### Settings — "Beautiful care"

Generous spacing, clear sections:

- **API Keys** — each key as subtle card with masked value, copy/reveal/delete
- **Billing** — current plan as feature card, credits as warm progress bar
- **Email Preferences** — toggle grid with warm toggle colors
- **Device Linking** — centered QR code with clear instructions

Section headers in Source Serif 4, generous whitespace between sections.

## Principles Applied (Interface Craft)

- **Pattern 1:** Reduce visual noise — no card strokes/shadows, background differentiation only
- **Pattern 3:** Visual entry points — hero panels on overview, heatmap on analytics
- **Pattern 6:** Consistent visual language — same type scale, colors, spacing everywhere
- **Pattern 7:** Warm language — "Strongest" / "Needs Attention" not "Top Mastery" / "Low Mastery"
- **Pattern 8:** Integrated metrics — stats built into charts/sections, not separate cards
- **Principle 8:** Less, but better — Overview has 3 sections, not 5

## Technical Constraints

- Vanilla JS SPA (no framework change)
- CSS variables for the design system
- Google Fonts: Source Serif 4, DM Sans (loaded in HTML shell)
- ECharts for visualizations (custom warm theme)
- Content-hashed assets via esbuild

## Out of Scope

- Framework migration (stays vanilla JS)
- New features/tabs
- Mobile-specific layouts (keep existing responsive breakpoint, just apply new styles)
- Dark mode
