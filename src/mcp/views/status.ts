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
  .hidden { display: none; }
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
