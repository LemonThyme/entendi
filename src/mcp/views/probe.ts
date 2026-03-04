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
