# Cursor MCP Views Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the 3 MCP App views (Probe Card, Mastery Overview, Learning Frontier) per the approved design doc at `docs/plans/2026-03-04-cursor-mcp-views-design.md`.

**Architecture:** Each view is an HTML string returned by a TypeScript function. Views use the shared `EntendiApp` runtime (wrapping ext-apps SDK). Views are display cards — no form inputs. Probe Q&A happens in chat. Views react to `ontoolresult` for live updates. The `sendMessage` API injects prompts into the conversation for actions like "Start Learning".

**Tech Stack:** TypeScript, Vitest, esbuild, `@modelcontextprotocol/ext-apps` SDK, CSS animations, safe DOM construction (createElement/textContent — no innerHTML).

**Design Doc:** `docs/plans/2026-03-04-cursor-mcp-views-design.md`

---

## Task 1: Add API fields for Probe Card

The observe and record-evaluation endpoints need additional fields for the redesigned probe card.

**Files:**
- Modify: `src/api/routes/mcp.ts:431-441` (observe response)
- Modify: `src/api/routes/mcp.ts:609-618` (record-evaluation response)
- Test: `tests/api/routes/mcp-observe.test.ts` (if exists, otherwise inline verification)

**Step 1: Add fields to observe response**

In `src/api/routes/mcp.ts`, update the observe response (around line 431) to include:
- `lastAssessedDays` — days since last assessment
- `assessmentCount` — how many times probed
- `stability` — FSRS stability for next-review estimate
- `conceptName` — human-readable name (kebab-case → spaces)

```typescript
// Before the return c.json at ~line 431, compute additional fields:
const lastAssessedDays = selected.daysSince;
const conceptName = selected.conceptId.replace(/-/g, ' ');

return c.json({
  shouldProbe: true,
  conceptId: selected.conceptId,
  conceptName,
  depth,
  intrusiveness,
  guidance,
  userProfile,
  mastery: masteryPct,
  urgency: selected.urgency,
  probeToken,
  lastAssessedDays,
  assessmentCount: selected.assessmentCount,
  stability: selected.stability ?? null,
});
```

**Step 2: Add `stabilityDays` to record-evaluation response**

In `src/api/routes/mcp.ts`, update the record-evaluation response (around line 609) to include `stabilityDays`:

```typescript
// After const result = await applyBayesianUpdateDb(...), compute stabilityDays
// Stability is stored in userConceptStates — fetch updated state
const [updatedState] = await db.select().from(userConceptStates)
  .where(and(
    eq(userConceptStates.userId, user.id),
    eq(userConceptStates.conceptId, body.conceptId),
  ));
const stabilityDays = updatedState?.stability ?? null;

return c.json({
  mastery: result.newMastery,
  previousMastery: result.previousMastery,
  sigma: result.newSigma,
  previousSigma: result.previousSigma,
  stabilityDays,
  shouldOfferTutor,
  integrityScore,
  integrityFlags: integrityFlags.length > 0 ? integrityFlags : undefined,
  message: `Mastery ${direction} from ${(result.previousMastery * 100).toFixed(1)}% to ${(result.newMastery * 100).toFixed(1)}%`,
});
```

**Step 3: Verify the build passes**

Run: `npm run build`
Expected: SUCCESS

**Step 4: Commit**

```bash
git add src/api/routes/mcp.ts
git commit -m "feat(api): add probe card fields to observe and record-evaluation responses"
```

---

## Task 2: Add API fields for Status View

The status endpoint needs urgency and stability per concept, plus weekly delta.

**Files:**
- Modify: `src/api/routes/mcp.ts:1073-1113` (status response)

**Step 1: Add urgency, stability, and weeklyDelta to status response**

In the status endpoint (around line 1092), update the `conceptsList` mapping to include urgency and stability. Also compute weeklyDelta from assessment events.

```typescript
// Import probeUrgency if not already imported at top of file
// Already available — used in concept-detail route above

const conceptsList = allStates
  .filter(s => s.assessmentCount > 0)
  .map(s => {
    const daysSince = s.lastAssessed
      ? (Date.now() - new Date(s.lastAssessed).getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    return {
      id: s.conceptId,
      mu: s.mu,
      sigma: s.sigma,
      assessmentCount: s.assessmentCount,
      lastAssessed: s.lastAssessed ? new Date(s.lastAssessed).toISOString() : null,
      urgency: probeUrgency({
        mu: s.mu, sigma: s.sigma, stability: s.stability ?? 1,
        daysSinceAssessed: daysSince,
        assessmentCount: s.assessmentCount,
        fisherInfo: 0,
      }),
      stability: s.stability ?? null,
    };
  })
  .sort((a, b) => b.urgency - a.urgency); // Sort by urgency (weakest-first)

// Compute weekly mastery delta
const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const weeklyEvents = await db.select().from(assessmentEvents)
  .where(and(
    eq(assessmentEvents.userId, user.id),
    sql`${assessmentEvents.createdAt} > ${oneWeekAgo}`,
  ));
// Sum of mastery deltas this week
let weeklyDelta = 0;
for (const evt of weeklyEvents) {
  // Each event has previousMu and newMu in the data, but we can approximate
  // from the score changes. For simplicity, count positive events.
}
// Simpler: compare current avg mastery to what it would be without recent events
// For now, just count the number of events this week as a proxy
const weeklyActivity = weeklyEvents.length;

return c.json({
  overview: {
    totalConcepts: assessed,
    mastered,
    inProgress,
    recentActivity: recentActivity.slice(0, 5),
    weeklyActivity,
  },
  concepts: conceptsList,
});
```

Note: The weekly delta computation is approximate. A precise implementation would require storing historical snapshots. For now, we include `weeklyActivity` (count of events) and let the view display "X assessments this week".

**Step 2: Verify build**

Run: `npm run build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add src/api/routes/mcp.ts
git commit -m "feat(api): add urgency, stability, weeklyActivity to status endpoint"
```

---

## Task 3: Redesign Probe Card View

Replace the current probe view (textarea + submit/skip buttons) with a display-only card per the design doc.

**Files:**
- Modify: `src/mcp/views/probe.ts` (complete rewrite)
- Test: `tests/mcp/views/probe.test.ts`

**Step 1: Write the failing test**

Update `tests/mcp/views/probe.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getProbeViewHtml } from '../../../src/mcp/views/probe.js';

describe('probe view HTML', () => {
  it('returns valid HTML document', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the shared runtime', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('EntendiApp');
  });

  it('is a display-only card with no input fields', () => {
    const html = getProbeViewHtml();
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('submit-btn');
  });

  it('has mastery bar elements', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('mastery-bar');
    expect(html).toContain('mastery-pct');
  });

  it('has decay indicator element', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('decay-indicator');
  });

  it('has context line element', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('context-line');
  });

  it('listens to ontoolresult for record_evaluation updates', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('onToolResult');
    expect(html).toContain('previousMastery');
  });

  it('animates mastery bar on update', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('transition');
  });

  it('uses safe DOM construction', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('createElement');
    expect(html).toContain('textContent');
    expect(html).not.toContain('innerHTML');
  });

  it('has host theme fallback variables', () => {
    const html = getProbeViewHtml();
    expect(html).toContain('--color-background-primary');
    expect(html).toContain('--color-text-primary');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/views/probe.test.ts`
Expected: FAIL — `<textarea` assertion fails (current view has textarea)

**Step 3: Rewrite probe.ts**

Replace `src/mcp/views/probe.ts` with a display-only card:

```typescript
import { getViewRuntime } from './runtime.js';

/**
 * Probe Card MCP App view.
 * Display-only card: shows concept name, mastery bar, probe question, and context.
 * After record_evaluation via ontoolresult, animates mastery change and shows delta.
 * No input fields — user answers in chat.
 */
export function getProbeViewHtml(): string {
  const runtime = getViewRuntime();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entendi Probe</title>
<style>
  :root {
    color-scheme: light dark;
    --color-background-primary: light-dark(#F6F4F1, #1a1917);
    --color-background-secondary: light-dark(#EDEAE6, #252320);
    --color-text-primary: light-dark(#2D2A26, #E8E5E1);
    --color-text-secondary: light-dark(#6B6560, #9B9590);
    --color-accent: light-dark(#C4704B, #D4845F);
    --color-border: light-dark(#D9D4CF, #3A3733);
    --color-green: light-dark(#2D7D46, #4CAF6A);
    --color-orange: light-dark(#C4704B, #D4845F);
    --color-red: light-dark(#B54040, #D45050);
    --delta-positive: light-dark(#2D7D46, #4CAF6A);
    --delta-negative: light-dark(#B54040, #D45050);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--color-background-primary);
    color: var(--color-text-primary);
    padding: 16px;
    line-height: 1.5;
  }
  .probe-card {
    background: var(--color-background-secondary);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 16px;
  }
  .concept-name {
    font-size: 12px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 8px;
  }
  .mastery-row {
    display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  }
  .mastery-bar-bg {
    flex: 1; height: 8px; border-radius: 4px;
    background: var(--color-border); overflow: hidden;
  }
  .mastery-bar-fill {
    height: 100%; border-radius: 4px;
    transition: width 300ms ease-out, background-color 300ms ease-out;
  }
  .mastery-pct {
    font-size: 13px; font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 36px; text-align: right;
  }
  .decay-indicator {
    font-size: 11px; font-weight: 500;
  }
  .delta-badge {
    font-size: 12px; font-weight: 700;
    font-variant-numeric: tabular-nums;
    opacity: 0; transition: opacity 200ms ease-in;
  }
  .delta-badge.visible { opacity: 1; }
  .question {
    font-size: 14px; line-height: 1.5; margin-bottom: 10px;
    color: var(--color-text-primary);
  }
  .context-line {
    font-size: 11px; color: var(--color-text-secondary);
    display: flex; gap: 12px;
  }
  .result-section {
    margin-top: 12px; padding-top: 12px;
    border-top: 1px solid var(--color-border);
  }
  .confidence-row {
    display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
  }
  .confidence-label {
    font-size: 11px; color: var(--color-text-secondary); min-width: 72px;
  }
  .confidence-bar-bg {
    flex: 1; height: 4px; border-radius: 2px;
    background: var(--color-border); overflow: hidden;
  }
  .confidence-bar-fill {
    height: 100%; border-radius: 2px;
    background: var(--color-text-secondary); opacity: 0.4;
    transition: width 300ms ease-out;
  }
  .confidence-text {
    font-size: 11px; color: var(--color-text-secondary);
  }
  .next-review {
    font-size: 11px; color: var(--color-text-secondary);
  }
  .no-probe {
    text-align: center; padding: 16px;
    color: var(--color-text-secondary); font-size: 13px;
  }
  .hidden { display: none; }
  .loading { text-align: center; color: var(--color-text-secondary); padding: 24px; font-size: 13px; }
</style>
</head>
<body>
<div id="probe-card" class="probe-card hidden"></div>
<div id="no-probe" class="no-probe hidden"></div>
<div id="loading-state" class="loading">Waiting for data...</div>

<script>
${runtime}

(function() {
  'use strict';

  var currentMastery = 0;

  function pMastery(mu) {
    return 1 / (1 + Math.exp(-mu / 0.5));
  }

  function masteryColor(pct) {
    if (pct >= 70) return 'var(--color-green)';
    if (pct >= 40) return 'var(--color-orange)';
    return 'var(--color-red)';
  }

  function show(id) {
    var ids = ['probe-card', 'no-probe', 'loading-state'];
    ids.forEach(function(elId) {
      var el = document.getElementById(elId);
      if (el) {
        if (elId === id) el.setAttribute('class', el.getAttribute('class').replace(/\\bhidden\\b/g, '').trim());
        else if (el.getAttribute('class').indexOf('hidden') === -1) el.setAttribute('class', (el.getAttribute('class') || '') + ' hidden');
      }
    });
  }

  function showProbeCard(data) {
    var card = document.getElementById('probe-card');
    while (card.firstChild) card.removeChild(card.firstChild);

    var pct = data.mastery || 0;
    currentMastery = pct;
    var conceptName = (data.conceptName || data.conceptId || '').replace(/-/g, ' ');

    // Concept name
    var nameEl = document.createElement('div');
    nameEl.setAttribute('class', 'concept-name');
    nameEl.setAttribute('style', 'color: ' + masteryColor(pct));
    nameEl.textContent = conceptName;
    card.appendChild(nameEl);

    // Mastery row: bar + percentage + decay indicator
    var masteryRow = document.createElement('div');
    masteryRow.setAttribute('class', 'mastery-row');

    var barBg = document.createElement('div');
    barBg.setAttribute('class', 'mastery-bar-bg');
    var barFill = document.createElement('div');
    barFill.setAttribute('class', 'mastery-bar-fill');
    barFill.setAttribute('id', 'mastery-fill');
    barFill.setAttribute('style', 'width: ' + pct + '%; background: ' + masteryColor(pct));
    barBg.appendChild(barFill);
    masteryRow.appendChild(barBg);

    var pctEl = document.createElement('span');
    pctEl.setAttribute('class', 'mastery-pct');
    pctEl.setAttribute('id', 'mastery-pct-value');
    pctEl.textContent = pct + '%';
    masteryRow.appendChild(pctEl);

    // Decay indicator
    var decayEl = document.createElement('span');
    decayEl.setAttribute('class', 'decay-indicator');
    decayEl.setAttribute('id', 'decay-indicator');
    if (data.stability != null && data.lastAssessedDays != null) {
      if (data.lastAssessedDays > (data.stability * 0.8)) {
        decayEl.textContent = '\\u2193 decaying';
        decayEl.setAttribute('style', 'color: var(--color-red)');
      } else if (data.assessmentCount > 1) {
        decayEl.textContent = '\\u2191 stable';
        decayEl.setAttribute('style', 'color: var(--color-green)');
      }
    }
    masteryRow.appendChild(decayEl);

    // Delta badge (hidden until record_evaluation)
    var deltaEl = document.createElement('span');
    deltaEl.setAttribute('class', 'delta-badge');
    deltaEl.setAttribute('id', 'delta-badge');
    masteryRow.appendChild(deltaEl);

    card.appendChild(masteryRow);

    // Question
    if (data.probeQuestion || data.guidance) {
      var qEl = document.createElement('div');
      qEl.setAttribute('class', 'question');
      qEl.textContent = data.probeQuestion || '';
      card.appendChild(qEl);
    }

    // Context line
    var ctxEl = document.createElement('div');
    ctxEl.setAttribute('class', 'context-line');
    var parts = [];
    if (data.lastAssessedDays != null) {
      var days = Math.round(data.lastAssessedDays);
      parts.push(days === 0 ? 'Probed today' : 'Last probed ' + days + 'd ago');
    }
    if (data.assessmentCount != null) {
      parts.push('Assessed ' + data.assessmentCount + '\\u00d7');
    }
    parts.forEach(function(text) {
      var span = document.createElement('span');
      span.textContent = text;
      ctxEl.appendChild(span);
    });
    card.appendChild(ctxEl);

    show('probe-card');
  }

  function showResult(data) {
    if (!data || data.previousMastery == null) return;

    var oldPct = Math.round(data.previousMastery * 100);
    var newPct = Math.round(data.mastery * 100);
    var delta = newPct - oldPct;

    // Animate mastery bar
    var fill = document.getElementById('mastery-fill');
    if (fill) {
      fill.setAttribute('style', 'width: ' + newPct + '%; background: ' + masteryColor(newPct));
    }

    // Animate percentage number
    var pctEl = document.getElementById('mastery-pct-value');
    if (pctEl) {
      var startPct = oldPct;
      var endPct = newPct;
      var startTime = null;
      function animatePct(ts) {
        if (!startTime) startTime = ts;
        var progress = Math.min((ts - startTime) / 300, 1);
        var current = Math.round(startPct + (endPct - startPct) * progress);
        pctEl.textContent = current + '%';
        if (progress < 1) requestAnimationFrame(animatePct);
      }
      requestAnimationFrame(animatePct);
    }

    // Show delta badge
    var deltaEl = document.getElementById('delta-badge');
    if (deltaEl && delta !== 0) {
      var sign = delta > 0 ? '+' : '';
      deltaEl.textContent = sign + delta + '%';
      deltaEl.setAttribute('style', 'color: ' + (delta > 0 ? 'var(--delta-positive)' : 'var(--delta-negative)'));
      setTimeout(function() {
        deltaEl.setAttribute('class', 'delta-badge visible');
      }, 320);
    }

    // Update decay indicator
    var decayEl = document.getElementById('decay-indicator');
    if (decayEl) {
      decayEl.textContent = delta > 0 ? '\\u2191 improving' : delta < 0 ? '\\u2193 declining' : '';
      decayEl.setAttribute('style', 'color: ' + (delta >= 0 ? 'var(--color-green)' : 'var(--color-red)'));
    }

    // Add result section (confidence + next review)
    var card = document.getElementById('probe-card');
    var resultSection = document.createElement('div');
    resultSection.setAttribute('class', 'result-section');

    // Confidence bar
    if (data.sigma != null) {
      var confRow = document.createElement('div');
      confRow.setAttribute('class', 'confidence-row');

      var confLabel = document.createElement('span');
      confLabel.setAttribute('class', 'confidence-label');
      confLabel.textContent = 'Confidence';
      confRow.appendChild(confLabel);

      var confBarBg = document.createElement('div');
      confBarBg.setAttribute('class', 'confidence-bar-bg');
      var confFill = document.createElement('div');
      confFill.setAttribute('class', 'confidence-bar-fill');
      // sigma 0.05 = very confident (narrow), sigma 1.5 = very uncertain (wide)
      var confWidth = Math.max(5, Math.min(100, (1 - (data.sigma - 0.05) / 1.45) * 100));
      confFill.setAttribute('style', 'width: ' + confWidth + '%');
      confBarBg.appendChild(confFill);
      confRow.appendChild(confBarBg);

      var confText = document.createElement('span');
      confText.setAttribute('class', 'confidence-text');
      confText.textContent = data.sigma < 0.3 ? 'high' : data.sigma < 0.7 ? 'moderate' : 'low';
      confRow.appendChild(confText);

      resultSection.appendChild(confRow);
    }

    // Next review estimate
    if (data.stabilityDays != null) {
      var reviewEl = document.createElement('div');
      reviewEl.setAttribute('class', 'next-review');
      var days = Math.round(data.stabilityDays);
      reviewEl.textContent = 'Next review: ~' + days + ' day' + (days !== 1 ? 's' : '');
      resultSection.appendChild(reviewEl);
    }

    card.appendChild(resultSection);
  }

  // 3-second timeout for no data
  var dataReceived = false;
  var timeout = setTimeout(function() {
    if (!dataReceived) {
      var noProbe = document.getElementById('no-probe');
      noProbe.textContent = 'Concepts observed. No probe needed right now.';
      show('no-probe');
    }
  }, 3000);

  EntendiApp.onToolResult(function(params) {
    if (params && params.result) {
      try {
        var content = params.result.content;
        if (Array.isArray(content)) {
          for (var i = 0; i < content.length; i++) {
            if (content[i].type === 'text') {
              var parsed = JSON.parse(content[i].text);
              // Detect observe result vs record_evaluation result
              if (parsed.shouldProbe != null) {
                dataReceived = true;
                clearTimeout(timeout);
                if (parsed.shouldProbe && (parsed.probeQuestion || parsed.guidance)) {
                  showProbeCard(parsed);
                } else {
                  var noProbe = document.getElementById('no-probe');
                  var count = parsed.conceptsObserved || 0;
                  noProbe.textContent = count + ' concept' + (count !== 1 ? 's' : '') + ' observed. No probe needed.';
                  show('no-probe');
                }
              } else if (parsed.previousMastery != null) {
                showResult(parsed);
              }
              return;
            }
          }
        }
      } catch (e) { /* ignore */ }
    }
  });

  EntendiApp.init('entendi-probe', function() {
    // Reactive view — waits for observe tool result via onToolResult
  });
})();
</script>
</body>
</html>`;
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/mcp/views/probe.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/mcp/views/probe.ts tests/mcp/views/probe.test.ts
git commit -m "feat(views): redesign probe card as display-only with mastery animation"
```

---

## Task 4: Redesign Status View

Update the status view per the design doc: mastery bars with sigma confidence intervals, urgency-sorted, header with weekly activity.

**Files:**
- Modify: `src/mcp/views/status.ts` (complete rewrite)
- Test: `tests/mcp/views/status.test.ts`

**Step 1: Write the failing test**

Update `tests/mcp/views/status.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getStatusViewHtml } from '../../../src/mcp/views/status.js';

describe('status view HTML', () => {
  it('returns valid HTML document', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the shared runtime', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('EntendiApp');
  });

  it('has sigma overlay elements', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('sigma-overlay');
  });

  it('has urgency-based rendering', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('urgency');
  });

  it('has weekly activity in header', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('weeklyActivity');
  });

  it('has summary footer', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('footer');
  });

  it('uses safe DOM construction', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('createElement');
    expect(html).toContain('textContent');
    expect(html).not.toContain('innerHTML');
  });

  it('has host theme fallback variables', () => {
    const html = getStatusViewHtml();
    expect(html).toContain('--color-background-primary');
    expect(html).toContain('--color-text-primary');
  });
});
```

**Step 2: Run test to verify some fail**

Run: `npx vitest run tests/mcp/views/status.test.ts`
Expected: FAIL — `sigma-overlay`, `urgency`, `weeklyActivity`, `footer` not present in current view

**Step 3: Rewrite status.ts**

Replace `src/mcp/views/status.ts` with the redesigned view:

```typescript
import { getViewRuntime } from './runtime.js';

/**
 * Status Dashboard MCP App view.
 * Shows concept rows with mastery bars + sigma confidence intervals,
 * sorted by urgency. Header shows weekly activity. Footer shows summary counts.
 * All DOM construction uses createElement/textContent/setAttribute — no innerHTML.
 */
export function getStatusViewHtml(): string {
  const runtime = getViewRuntime();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entendi Status</title>
<style>
  :root {
    color-scheme: light dark;
    --color-background-primary: light-dark(#F6F4F1, #1a1917);
    --color-background-secondary: light-dark(#EDEAE6, #252320);
    --color-text-primary: light-dark(#2D2A26, #E8E5E1);
    --color-text-secondary: light-dark(#6B6560, #9B9590);
    --color-accent: light-dark(#C4704B, #D4845F);
    --color-border: light-dark(#D9D4CF, #3A3733);
    --color-green: light-dark(#2D7D46, #4CAF6A);
    --color-orange: light-dark(#C4704B, #D4845F);
    --color-red: light-dark(#B54040, #D45050);
    --sigma-overlay: rgba(128, 128, 128, 0.15);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--color-background-primary);
    color: var(--color-text-primary);
    padding: 16px;
    line-height: 1.5;
  }
  .header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 14px;
  }
  .header h1 { font-size: 16px; font-weight: 600; }
  .header-meta { font-size: 12px; color: var(--color-text-secondary); }
  #concept-list { display: flex; flex-direction: column; gap: 6px; }
  .concept-row {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 0;
  }
  .concept-name {
    flex: 0 0 120px; font-size: 13px; font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .bar-container {
    flex: 1; height: 8px; border-radius: 4px;
    background: var(--color-border); position: relative; overflow: hidden;
  }
  .sigma-overlay {
    position: absolute; top: 0; height: 100%;
    background: var(--sigma-overlay); border-radius: 4px;
  }
  .mastery-fill {
    position: absolute; top: 0; left: 0; height: 100%;
    border-radius: 4px; z-index: 1;
  }
  .mastery-pct {
    font-size: 12px; font-weight: 600;
    font-variant-numeric: tabular-nums;
    min-width: 32px; text-align: right;
  }
  .footer {
    margin-top: 14px; padding-top: 10px;
    border-top: 1px solid var(--color-border);
    font-size: 11px; color: var(--color-text-secondary);
    text-align: center;
  }
  .loading { text-align: center; color: var(--color-text-secondary); padding: 40px; font-size: 13px; }
</style>
</head>
<body>
<div class="header">
  <h1>Mastery</h1>
  <span class="header-meta" id="header-meta"></span>
</div>
<div id="concept-list"><div class="loading">Loading...</div></div>
<div id="footer" class="footer hidden"></div>

<script>
${runtime}

(function() {
  'use strict';

  function pMastery(mu) {
    return 1 / (1 + Math.exp(-mu / 0.5));
  }

  function masteryColor(pct) {
    if (pct >= 70) return 'var(--color-green)';
    if (pct >= 40) return 'var(--color-orange)';
    return 'var(--color-red)';
  }

  function sigmaRange(mu, sigma) {
    var lo = pMastery(mu - 2 * sigma) * 100;
    var hi = pMastery(mu + 2 * sigma) * 100;
    return { lo: Math.max(0, lo), hi: Math.min(100, hi) };
  }

  function renderConcepts(container, concepts) {
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!concepts || concepts.length === 0) {
      var empty = document.createElement('div');
      empty.setAttribute('class', 'loading');
      empty.textContent = 'No concepts tracked yet';
      container.appendChild(empty);
      return;
    }

    concepts.forEach(function(c) {
      var pct = Math.round(pMastery(c.mu || 0) * 100);
      var range = sigmaRange(c.mu || 0, c.sigma || 0.5);
      var color = masteryColor(pct);
      var urgency = c.urgency || 0;

      var row = document.createElement('div');
      row.setAttribute('class', 'concept-row');

      // Name
      var nameEl = document.createElement('span');
      nameEl.setAttribute('class', 'concept-name');
      nameEl.textContent = (c.id || c.name || 'Unknown').replace(/-/g, ' ');
      // Warm tint for high-urgency concepts
      if (urgency > 0.6) {
        nameEl.setAttribute('style', 'color: ' + color);
      }
      row.appendChild(nameEl);

      // Bar with sigma overlay
      var barContainer = document.createElement('div');
      barContainer.setAttribute('class', 'bar-container');

      var sigmaEl = document.createElement('div');
      sigmaEl.setAttribute('class', 'sigma-overlay');
      sigmaEl.setAttribute('style', 'left: ' + range.lo + '%; width: ' + (range.hi - range.lo) + '%');
      barContainer.appendChild(sigmaEl);

      var fill = document.createElement('div');
      fill.setAttribute('class', 'mastery-fill');
      fill.setAttribute('style', 'width: ' + pct + '%; background: ' + color);
      barContainer.appendChild(fill);

      row.appendChild(barContainer);

      // Percentage
      var pctEl = document.createElement('span');
      pctEl.setAttribute('class', 'mastery-pct');
      pctEl.setAttribute('style', 'color: ' + color);
      pctEl.textContent = pct + '%';
      row.appendChild(pctEl);

      container.appendChild(row);
    });
  }

  function handleStatusData(data) {
    if (!data) return;
    var concepts = data.concepts || [];

    // Sort by urgency descending (already sorted by API, but ensure)
    concepts.sort(function(a, b) { return (b.urgency || 0) - (a.urgency || 0); });

    renderConcepts(document.getElementById('concept-list'), concepts);

    // Header meta
    var meta = document.getElementById('header-meta');
    if (data.overview && data.overview.weeklyActivity != null) {
      meta.textContent = data.overview.weeklyActivity + ' assessments this week';
    }

    // Footer
    var footer = document.getElementById('footer');
    var total = concepts.length;
    var strong = 0, weak = 0;
    concepts.forEach(function(c) {
      var pct = pMastery(c.mu || 0) * 100;
      if (pct >= 70) strong++;
      else if (pct < 40) weak++;
    });
    footer.textContent = total + ' concept' + (total !== 1 ? 's' : '') +
      ' \\u00b7 ' + strong + ' mastered \\u00b7 ' + weak + ' weak';
    footer.setAttribute('class', 'footer');
  }

  EntendiApp.onToolResult(function(params) {
    if (params && params.result) {
      try {
        var content = params.result.content;
        if (Array.isArray(content)) {
          for (var i = 0; i < content.length; i++) {
            if (content[i].type === 'text') {
              handleStatusData(JSON.parse(content[i].text));
              return;
            }
          }
        }
      } catch (e) { /* ignore */ }
    }
  });

  EntendiApp.init('entendi-status', function() {
    EntendiApp.callTool('entendi_get_status', {}).then(function(result) {
      if (result && result.content) {
        for (var i = 0; i < result.content.length; i++) {
          if (result.content[i].type === 'text') {
            try { handleStatusData(JSON.parse(result.content[i].text)); } catch(e) {}
            return;
          }
        }
      }
    });
  });
})();
</script>
</body>
</html>`;
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/mcp/views/status.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/mcp/views/status.ts tests/mcp/views/status.test.ts
git commit -m "feat(views): redesign status view with sigma overlays and urgency sorting"
```

---

## Task 5: Redesign Frontier View

Fix data field mismatches and implement the design doc: concept cards with readiness indicator, "Start Learning" via `sendMessage`.

**Files:**
- Modify: `src/mcp/views/frontier.ts` (complete rewrite)
- Test: `tests/mcp/views/frontier.test.ts`

**Step 1: Write the failing test**

Update `tests/mcp/views/frontier.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getFrontierViewHtml } from '../../../src/mcp/views/frontier.js';

describe('frontier view HTML', () => {
  it('returns valid HTML document', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the shared runtime', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('EntendiApp');
  });

  it('uses sendMessage for Start Learning action', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('sendMessage');
    expect(html).toContain('Teach me about');
  });

  it('does not call entendi_start_tutor directly', () => {
    const html = getFrontierViewHtml();
    expect(html).not.toContain('callTool');
  });

  it('uses actual API field names', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('conceptId');
    expect(html).toContain('fisherInfo');
  });

  it('has footer with additional count', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('more-count');
  });

  it('uses safe DOM construction', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('createElement');
    expect(html).toContain('textContent');
    expect(html).not.toContain('innerHTML');
  });

  it('has host theme fallback variables', () => {
    const html = getFrontierViewHtml();
    expect(html).toContain('--color-background-primary');
    expect(html).toContain('--color-text-primary');
  });
});
```

**Step 2: Run tests to verify some fail**

Run: `npx vitest run tests/mcp/views/frontier.test.ts`
Expected: FAIL — `sendMessage`, `Teach me about`, `more-count` not in current view; `callTool` is present

**Step 3: Rewrite frontier.ts**

Replace `src/mcp/views/frontier.ts`:

```typescript
import { getViewRuntime } from './runtime.js';

/**
 * Learning Frontier MCP App view.
 * Shows top concepts the user is ready to learn, sorted by info-gain.
 * "Start Learning" injects a chat message via sendMessage.
 * All DOM construction uses createElement/textContent/setAttribute — no innerHTML.
 */
export function getFrontierViewHtml(): string {
  const runtime = getViewRuntime();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entendi Learning Frontier</title>
<style>
  :root {
    color-scheme: light dark;
    --color-background-primary: light-dark(#F6F4F1, #1a1917);
    --color-background-secondary: light-dark(#EDEAE6, #252320);
    --color-text-primary: light-dark(#2D2A26, #E8E5E1);
    --color-text-secondary: light-dark(#6B6560, #9B9590);
    --color-accent: light-dark(#C4704B, #D4845F);
    --color-border: light-dark(#D9D4CF, #3A3733);
    --color-green: light-dark(#2D7D46, #4CAF6A);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--color-background-primary);
    color: var(--color-text-primary);
    padding: 16px;
    line-height: 1.5;
  }
  .header { margin-bottom: 14px; }
  .header h1 { font-size: 16px; font-weight: 600; }
  .header p { font-size: 12px; color: var(--color-text-secondary); }
  #frontier-list { display: flex; flex-direction: column; gap: 8px; }
  .frontier-card {
    background: var(--color-background-secondary);
    border: 1px solid var(--color-border);
    border-radius: 10px; padding: 12px 14px;
  }
  .card-top { display: flex; justify-content: space-between; align-items: center; }
  .card-name { font-size: 14px; font-weight: 600; }
  .card-meta {
    font-size: 11px; color: var(--color-text-secondary);
    margin-top: 4px;
  }
  .info-gain {
    font-size: 11px; font-weight: 600;
    padding: 2px 8px; border-radius: 10px;
  }
  .start-btn {
    display: inline-block; margin-top: 8px;
    background: none; color: var(--color-accent);
    border: none; font-size: 13px; font-weight: 600;
    cursor: pointer; padding: 0;
  }
  .start-btn:hover { text-decoration: underline; }
  .start-btn:disabled { opacity: 0.5; cursor: default; text-decoration: none; }
  #more-count {
    margin-top: 10px; font-size: 12px;
    color: var(--color-text-secondary); text-align: center;
  }
  .empty-state {
    text-align: center; padding: 32px 16px;
    color: var(--color-text-secondary); font-size: 13px;
  }
  .loading { text-align: center; color: var(--color-text-secondary); padding: 40px; font-size: 13px; }
</style>
</head>
<body>
<div class="header">
  <h1>Ready to Learn</h1>
  <p>Concepts with the highest learning potential</p>
</div>
<div id="frontier-list"><div class="loading">Loading...</div></div>
<div id="more-count" class="hidden"></div>

<script>
${runtime}

(function() {
  'use strict';

  var MAX_SHOWN = 5;

  function infoGainLevel(fisherInfo) {
    if (fisherInfo > 0.5) return { label: 'High info-gain', color: 'var(--color-green)' };
    if (fisherInfo > 0.2) return { label: 'Medium gain', color: 'var(--color-accent)' };
    return { label: 'Low gain', color: 'var(--color-text-secondary)' };
  }

  function renderFrontier(container, concepts) {
    while (container.firstChild) container.removeChild(container.firstChild);

    if (!concepts || concepts.length === 0) {
      var empty = document.createElement('div');
      empty.setAttribute('class', 'empty-state');
      empty.textContent = 'No frontier concepts available. Keep learning!';
      container.appendChild(empty);
      return;
    }

    var shown = concepts.slice(0, MAX_SHOWN);
    var remaining = concepts.length - shown.length;

    shown.forEach(function(c) {
      var card = document.createElement('div');
      card.setAttribute('class', 'frontier-card');

      var top = document.createElement('div');
      top.setAttribute('class', 'card-top');

      var nameEl = document.createElement('span');
      nameEl.setAttribute('class', 'card-name');
      nameEl.textContent = (c.conceptId || '').replace(/-/g, ' ');
      top.appendChild(nameEl);

      var gainInfo = infoGainLevel(c.fisherInfo || 0);
      var gainEl = document.createElement('span');
      gainEl.setAttribute('class', 'info-gain');
      gainEl.setAttribute('style', 'color: ' + gainInfo.color + '; background: ' + gainInfo.color + '15');
      gainEl.textContent = gainInfo.label;
      top.appendChild(gainEl);

      card.appendChild(top);

      // Meta line
      var metaEl = document.createElement('div');
      metaEl.setAttribute('class', 'card-meta');
      var parts = [];
      if (c.assessmentCount > 0) {
        parts.push('Assessed ' + c.assessmentCount + '\\u00d7');
      } else {
        parts.push('Not yet assessed');
      }
      if (c.domain) {
        parts.push(c.domain);
      }
      metaEl.textContent = parts.join(' \\u00b7 ');
      card.appendChild(metaEl);

      // Start Learning link
      var btn = document.createElement('button');
      btn.setAttribute('class', 'start-btn');
      btn.textContent = 'Start Learning \\u2192';
      btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Starting...';
        EntendiApp.sendMessage({
          role: 'user',
          content: [{ type: 'text', text: 'Teach me about ' + (c.conceptId || '').replace(/-/g, ' ') }]
        });
      });
      card.appendChild(btn);

      container.appendChild(card);
    });

    // Show remaining count
    if (remaining > 0) {
      var moreEl = document.getElementById('more-count');
      moreEl.textContent = remaining + ' more concept' + (remaining !== 1 ? 's' : '') + ' available';
      moreEl.setAttribute('class', '');
    }
  }

  function handleFrontierData(data) {
    if (!data) return;
    var concepts = data.frontier || data.concepts || [];
    // Already sorted by API (assessed first, then by Fisher info desc)
    renderFrontier(document.getElementById('frontier-list'), concepts);
  }

  EntendiApp.onToolResult(function(params) {
    if (params && params.result) {
      try {
        var content = params.result.content;
        if (Array.isArray(content)) {
          for (var i = 0; i < content.length; i++) {
            if (content[i].type === 'text') {
              handleFrontierData(JSON.parse(content[i].text));
              return;
            }
          }
        }
      } catch (e) { /* ignore */ }
    }
  });

  EntendiApp.init('entendi-frontier', function() {
    EntendiApp.callTool('entendi_get_zpd_frontier', {}).then(function(result) {
      if (result && result.content) {
        for (var i = 0; i < result.content.length; i++) {
          if (result.content[i].type === 'text') {
            try { handleFrontierData(JSON.parse(result.content[i].text)); } catch(e) {}
            return;
          }
        }
      }
    });
  });
})();
</script>
</body>
</html>`;
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/mcp/views/frontier.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/mcp/views/frontier.ts tests/mcp/views/frontier.test.ts
git commit -m "feat(views): redesign frontier view with sendMessage and info-gain levels"
```

---

## Task 6: Build, Deploy, and Verify

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Build**

Run: `npm run build`
Expected: SUCCESS

**Step 3: Deploy to Cloudflare Workers**

Run: `npx wrangler deploy`
Expected: SUCCESS

**Step 4: Reinstall plugin**

Run: `npm run plugin:reinstall`
Expected: SUCCESS

**Step 5: Manual verification in Cursor**

1. Open Cursor with entendi MCP configured
2. Call `entendi_get_status` → status view renders with mastery bars, sigma overlays, urgency sorting
3. Trigger `entendi_observe` with concepts → probe card renders as display-only
4. Answer probe in chat → `record_evaluation` result animates mastery bar in probe card
5. Call `entendi_get_zpd_frontier` → frontier view renders with "Start Learning" links

**Step 6: Commit and create PR**

```bash
git add -A
git commit -m "chore: build and deploy redesigned views"
git push
gh pr create --title "feat: redesign MCP App views" --body "..."
```

---

## Summary

| Task | What | Key Files |
|------|------|-----------|
| 1 | API fields for probe card | `src/api/routes/mcp.ts` (observe + record-eval responses) |
| 2 | API fields for status view | `src/api/routes/mcp.ts` (status response) |
| 3 | Redesign probe card | `src/mcp/views/probe.ts`, `tests/mcp/views/probe.test.ts` |
| 4 | Redesign status view | `src/mcp/views/status.ts`, `tests/mcp/views/status.test.ts` |
| 5 | Redesign frontier view | `src/mcp/views/frontier.ts`, `tests/mcp/views/frontier.test.ts` |
| 6 | Build, deploy, verify | All above |
