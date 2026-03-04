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
  .hidden { display: none; }
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
