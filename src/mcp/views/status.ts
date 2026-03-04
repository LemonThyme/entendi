import { getViewRuntime } from './runtime.js';

/**
 * Status Dashboard MCP App view.
 * Shows overall mastery ring, stats row, and concept list sorted weakest-first.
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
    --color-green: light-dark(#4A9E6B, #5DB87E);
    --color-orange: light-dark(#C4704B, #D4845F);
    --color-red: light-dark(#C44B4B, #D46060);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--color-background-primary);
    color: var(--color-text-primary);
    padding: 16px;
    line-height: 1.5;
  }
  .header { text-align: center; margin-bottom: 16px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header p { font-size: 13px; color: var(--color-text-secondary); }
  #overall-mastery { display: flex; justify-content: center; margin-bottom: 16px; }
  .ring-label { font-size: 24px; font-weight: 700; }
  .stats-row {
    display: flex; gap: 12px; justify-content: center; margin-bottom: 16px;
  }
  .stat-card {
    background: var(--color-background-secondary);
    border-radius: 8px; padding: 8px 16px; text-align: center;
    border: 1px solid var(--color-border);
  }
  .stat-card .count { font-size: 20px; font-weight: 700; }
  .stat-card .label { font-size: 11px; color: var(--color-text-secondary); text-transform: uppercase; }
  #concept-list { display: flex; flex-direction: column; gap: 8px; }
  .concept-row {
    display: flex; align-items: center; gap: 10px;
    background: var(--color-background-secondary);
    border-radius: 8px; padding: 10px 12px;
    border: 1px solid var(--color-border);
  }
  .concept-name { flex: 1; font-size: 14px; font-weight: 500; }
  .mastery-bar-bg {
    width: 80px; height: 6px; border-radius: 3px;
    background: var(--color-border);
  }
  .mastery-bar-fill { height: 100%; border-radius: 3px; }
  .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600;
  }
  .loading { text-align: center; color: var(--color-text-secondary); padding: 40px; }
</style>
</head>
<body>
<div class="header">
  <h1>Mastery Status</h1>
  <p>Your comprehension overview</p>
</div>
<div id="overall-mastery"></div>
<div class="stats-row" id="stats-row"></div>
<div id="concept-list"><div class="loading">Loading...</div></div>

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

  function badgeText(pct) {
    if (pct >= 70) return 'Strong';
    if (pct >= 40) return 'Growing';
    return 'Weak';
  }

  function renderRing(container, pct) {
    var size = 100;
    var stroke = 8;
    var radius = (size - stroke) / 2;
    var circumference = 2 * Math.PI * radius;
    var offset = circumference * (1 - pct / 100);

    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);

    var bgCircle = document.createElementNS(ns, 'circle');
    bgCircle.setAttribute('cx', String(size / 2));
    bgCircle.setAttribute('cy', String(size / 2));
    bgCircle.setAttribute('r', String(radius));
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', 'var(--color-border)');
    bgCircle.setAttribute('stroke-width', String(stroke));
    svg.appendChild(bgCircle);

    var fgCircle = document.createElementNS(ns, 'circle');
    fgCircle.setAttribute('cx', String(size / 2));
    fgCircle.setAttribute('cy', String(size / 2));
    fgCircle.setAttribute('r', String(radius));
    fgCircle.setAttribute('fill', 'none');
    fgCircle.setAttribute('stroke', masteryColor(pct));
    fgCircle.setAttribute('stroke-width', String(stroke));
    fgCircle.setAttribute('stroke-dasharray', String(circumference));
    fgCircle.setAttribute('stroke-dashoffset', String(offset));
    fgCircle.setAttribute('stroke-linecap', 'round');
    fgCircle.setAttribute('transform', 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')');
    svg.appendChild(fgCircle);

    var text = document.createElementNS(ns, 'text');
    text.setAttribute('x', '50%');
    text.setAttribute('y', '50%');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', 'var(--color-text-primary)');
    text.setAttribute('font-size', '24');
    text.setAttribute('font-weight', '700');
    text.textContent = Math.round(pct) + '%';
    svg.appendChild(text);

    container.appendChild(svg);
  }

  function renderStats(container, strong, growing, weak) {
    var items = [
      { count: strong, label: 'Strong', color: 'var(--color-green)' },
      { count: growing, label: 'Growing', color: 'var(--color-orange)' },
      { count: weak, label: 'Weak', color: 'var(--color-red)' }
    ];
    items.forEach(function(item) {
      var card = document.createElement('div');
      card.setAttribute('class', 'stat-card');
      var countEl = document.createElement('div');
      countEl.setAttribute('class', 'count');
      countEl.setAttribute('style', 'color: ' + item.color);
      countEl.textContent = String(item.count);
      var labelEl = document.createElement('div');
      labelEl.setAttribute('class', 'label');
      labelEl.textContent = item.label;
      card.appendChild(countEl);
      card.appendChild(labelEl);
      container.appendChild(card);
    });
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
      var row = document.createElement('div');
      row.setAttribute('class', 'concept-row');

      var name = document.createElement('span');
      name.setAttribute('class', 'concept-name');
      name.textContent = c.name || c.conceptId || 'Unknown';
      row.appendChild(name);

      var barBg = document.createElement('div');
      barBg.setAttribute('class', 'mastery-bar-bg');
      var barFill = document.createElement('div');
      barFill.setAttribute('class', 'mastery-bar-fill');
      barFill.setAttribute('style', 'width: ' + pct + '%; background: ' + masteryColor(pct));
      barBg.appendChild(barFill);
      row.appendChild(barBg);

      var badge = document.createElement('span');
      badge.setAttribute('class', 'badge');
      badge.setAttribute('style', 'color: ' + masteryColor(pct) + '; background: ' + masteryColor(pct) + '20');
      badge.textContent = badgeText(pct);
      row.appendChild(badge);

      container.appendChild(row);
    });
  }

  function handleStatusData(data) {
    if (!data) return;
    var concepts = data.concepts || [];
    concepts.sort(function(a, b) { return (a.mu || 0) - (b.mu || 0); });

    var totalMastery = 0;
    var strong = 0, growing = 0, weak = 0;
    concepts.forEach(function(c) {
      var pct = pMastery(c.mu || 0) * 100;
      totalMastery += pct;
      if (pct >= 70) strong++;
      else if (pct >= 40) growing++;
      else weak++;
    });
    var avgMastery = concepts.length > 0 ? totalMastery / concepts.length : 0;

    var ringEl = document.getElementById('overall-mastery');
    while (ringEl.firstChild) ringEl.removeChild(ringEl.firstChild);
    renderRing(ringEl, avgMastery);

    var statsEl = document.getElementById('stats-row');
    while (statsEl.firstChild) statsEl.removeChild(statsEl.firstChild);
    renderStats(statsEl, strong, growing, weak);

    renderConcepts(document.getElementById('concept-list'), concepts);
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
      } catch (e) { /* ignore parse errors */ }
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
