# Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Full visual overhaul of the Entendi dashboard with Palette C (Stone + Terracotta), unified design system, and redesigned Overview tab.

**Architecture:** Three layers — (1) CSS design system variables + base styles, (2) HTML shell font loading, (3) JS rendering functions per tab. CSS changes propagate everywhere via variables. JS changes are per-tab function rewrites.

**Tech Stack:** Vanilla JS, CSS custom properties, Google Fonts (Source Serif 4, DM Sans), ECharts warm theme

**Design doc:** `docs/plans/2026-02-27-dashboard-redesign-design.md`

---

## Task Grouping for Parallel Work

These tasks have clear file ownership and can be parallelized:

| Group | Files | Tasks |
|-------|-------|-------|
| **CSS + Shell** | `dashboard.css`, `dashboard.ts` | 1, 2 |
| **Overview JS** | `dashboard.js` (overview rendering) | 3 |
| **Analytics + Charts** | `dashboard.js` (chart functions) | 4 |
| **Concepts + Detail** | `dashboard.js` (concepts tab) | 5 |
| **Remaining Tabs** | `dashboard.js` + `dashboard.css` (integrity, org, settings) | 6, 7, 8 |

Tasks 1-2 must complete first (design system foundation). Tasks 3-8 can run in parallel after that.

---

### Task 1: CSS Design System — Replace variables and base styles

**Files:**
- Modify: `src/dashboard/dashboard.css` (full file — variables, body, all component styles)

**Overview of changes:**

Replace all CSS custom properties in `:root` with the new warm palette. Update `body` font-family. Update all component styles to remove borders on cards (use background differentiation only), apply `var(--font-display)` to headings, `var(--font-body)` to body text. Update hover states, focus ring colors, toast, skeleton, and empty states.

**Key replacements:**

1. `:root` variables → new warm palette (see design doc Color Palette table)
2. Add `--font-display` and `--font-body` variables
3. `body` font-family → `var(--font-body)`
4. `.header h1` → `font-family: var(--font-display)`
5. `.section-title` → `font-family: var(--font-display); font-size: 1.125rem`
6. `.stat-card` → `border: none` (background only)
7. `.stat-value` → `font-family: var(--font-display)`
8. `.stat-label` → `font-family: var(--font-body); font-size: 0.6875rem`
9. `.concept-list` → remove `border: 1px solid var(--border)`
10. `.chart-panel` → `border: none`
11. `.key-card` → `border: none`
12. `.plan-card` → `border: none`
13. `.auth-container` → `border: none`
14. `.toast` → `background: var(--accent); color: white; border: none`
15. `.empty-state` → add `font-family: var(--font-display); font-style: italic`
16. `.skeleton` → use `var(--bg-card)` and `var(--border)`
17. Focus rings → `rgba(196,112,75,0.15)` instead of blue
18. Hover states → `background: var(--bg)` for table rows
19. Table headers → `background: var(--bg)` not `#f9fafb`
20. `.key-new:hover` → `background: #EDDCD3`
21. `.earned-free-progress` → use `var(--accent-light)` and `var(--accent)`
22. `.btn-primary:hover` → `background: #A85D3D`

Add new CSS classes for the Overview hero panels:

```css
.hero-panel { background: var(--bg-card); border-radius: 8px; padding: 20px; }
.hero-panel-title { font-family: var(--font-display); font-size: 1rem; font-weight: 600; margin-bottom: 16px; }
.hero-concept { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.hero-concept:last-child { border-bottom: none; }
.hero-concept-name { flex: 1; font-size: 0.8125rem; font-weight: 500; }
.hero-concept-bar { width: 80px; height: 6px; background: var(--border); border-radius: 4px; overflow: hidden; }
.hero-concept-bar-fill { height: 100%; border-radius: 4px; }
.hero-concept-pct { font-size: 0.75rem; font-weight: 500; width: 32px; text-align: right; font-variant-numeric: tabular-nums; }
.hero-concept-meta { font-size: 0.6875rem; color: var(--text-tertiary); }
.trend-up { color: var(--green); }
.trend-down { color: var(--red); }
.trend-flat { color: var(--text-tertiary); }
```

**Verification:** `npm run build` succeeds.

**Commit:** `git commit -m "style: replace design system with Stone + Terracotta palette"`

---

### Task 2: HTML Shell — Load Google Fonts and update Overview structure

**Files:**
- Modify: `src/api/routes/dashboard.ts`

**Changes:**

1. Replace the Space Grotesk Google Font link (line 26) with Source Serif 4 + DM Sans:

```
https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap
```

2. Replace the `tab-overview` contents (lines 47-79) — remove stats-row, zpd-section, knowledge map. Replace with hero panels + activity:

```html
<div class="tab-content active" id="tab-overview">
  <div style="display:flex;gap:16px;margin-bottom:32px;" id="hero-panels">
    <div style="flex:1;" id="panel-strongest"></div>
    <div style="flex:1;" id="panel-attention"></div>
  </div>
  <div class="section">
    <div class="section-header">
      <div class="section-title">Recent Activity</div>
    </div>
    <div id="activity-area"></div>
  </div>
</div>
```

3. Remove `<div class="stats-row" id="analytics-stats"></div>` from the analytics tab (line 82).

4. Update `getLinkShellHTML` — add Google Fonts links, update CSS variables to match new palette, update body font-family.

**Verification:** `npm run build` succeeds.

**Commit:** `git commit -m "feat: load Source Serif 4 + DM Sans, redesign overview HTML structure"`

---

### Task 3: Overview JS — Strongest/Needs Attention + compact activity

**Files:**
- Modify: `src/dashboard/dashboard.js` (renderStats → renderOverviewHero, renderActivity, loadData)

**Changes:**

1. Replace `renderStats` with `renderOverviewHero(concepts, mastery)` — merges concepts with mastery data, sorts by mu, renders top 3 in "Strongest" panel (sage green bars) and bottom 3 in "Needs Attention" panel (brick red bars).

2. Update `loadData` — call `renderOverviewHero(concepts, mastery)` instead of `renderStats(statusData)`. Remove ZPD frontier rendering from Overview.

3. Update `renderActivity` — change from table to compact timeline layout with inline mastery deltas.

4. Remove `renderZpdFrontier` call from Overview flow (function can stay for potential use elsewhere).

**Verification:** `npm run build` succeeds. Start `npm run api:dev`, open browser, verify Overview shows two hero panels.

**Commit:** `git commit -m "feat: overview shows Strongest/Needs Attention hero panels"`

---

### Task 4: Analytics + Charts — Warm ECharts theme

**Files:**
- Modify: `src/dashboard/dashboard.js` (ECharts init calls, renderAnalyticsStats removal)

**Changes:**

1. Register warm ECharts theme after charts load:

```javascript
echarts.registerTheme('warm', {
  color: ['#C4704B', '#5B7B5E', '#B8860B', '#7A7268', '#B84233', '#9B9389'],
  backgroundColor: 'transparent',
  textStyle: { fontFamily: "'DM Sans', sans-serif", color: '#7A7268' },
  categoryAxis: { axisLine: { lineStyle: { color: '#E0DCD6' } }, splitLine: { lineStyle: { color: '#E0DCD6' } } },
  valueAxis: { axisLine: { lineStyle: { color: '#E0DCD6' } }, splitLine: { lineStyle: { color: '#E0DCD6' } } },
});
```

2. Change all `echarts.init(el)` → `echarts.init(el, 'warm')` in: renderActivityHeatmap, renderVelocityChart, renderDomainRadar, and integrity chart functions.

3. Remove `renderAnalyticsStats` function call (stat cards removed from analytics tab).

**Verification:** `npm run build` succeeds. Charts render with warm palette colors.

**Commit:** `git commit -m "style: warm ECharts theme, remove analytics stat cards"`

---

### Task 5: Concepts Tab — Consistent typography

**Files:**
- Modify: `src/dashboard/dashboard.js` (renderConceptsTab, concept detail)
- Modify: `src/dashboard/dashboard.css` (.domain-badge)

**Changes:**

1. In concept detail header rendering, ensure h2 uses `font-family:var(--font-display)`.

2. Update `.domain-badge` in CSS to use `var(--font-body)` and `var(--bg-card)` background.

3. Ensure concept detail section headers use the `.section-title` class.

**Verification:** `npm run build` succeeds.

**Commit:** `git commit -m "style: concepts tab consistent typography"`

---

### Task 6: Integrity Tab — Warm chart colors

**Files:**
- Modify: `src/dashboard/dashboard.js` (integrity rendering)

**Changes:**

1. Verify integrity charts use the warm theme (from Task 4's `echarts.init(el, 'warm')`).
2. If any hardcoded colors exist in integrity chart options, replace with palette values.

**Verification:** `npm run build` succeeds.

**Commit:** `git commit -m "style: integrity charts warm palette"`

---

### Task 7: Organization Tab — Warm hover/header styles

**Files:**
- Modify: `src/dashboard/dashboard.css` (hover states, table headers)
- Modify: `src/dashboard/dashboard.js` (org section titles)

**Changes:**

1. CSS: Update all hover states to `var(--bg)`, table header backgrounds to `var(--bg)`.
2. JS: Ensure org section titles use `.section-title` class (inherits Source Serif 4).

**Verification:** `npm run build` succeeds.

**Commit:** `git commit -m "style: organization tab warm styling"`

---

### Task 8: Settings Tab — Beautiful care

**Files:**
- Modify: `src/dashboard/dashboard.js` (renderSettings)
- Modify: `src/dashboard/dashboard.css` (settings styles)

**Changes:**

1. Ensure each settings section is wrapped in `<div class="section">` with `.section-title` headers.
2. Update key-new hover to warm color.
3. Update earned-free-progress to terracotta accent.
4. Add generous spacing between sections.

**Verification:** `npm run build` succeeds.

**Commit:** `git commit -m "style: settings tab with warm care"`

---

### Task 9: Final Verification

1. `npm run build` — no errors
2. `npm test` — all tests pass
3. `npm run api:dev` — open browser, visually check all 6 tabs
4. Verify fonts load (Source Serif 4 for headings, DM Sans for body)
5. Verify no old blue accent colors remain
6. Final commit if any tweaks needed
