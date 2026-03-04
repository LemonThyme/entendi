import { getViewRuntime } from './runtime.js';

/**
 * ZPD Frontier MCP App view.
 * Shows learning frontier concepts sorted by readiness, with "Start Learning" buttons.
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
    --color-green: light-dark(#4A9E6B, #5DB87E);
    --color-orange: light-dark(#C4704B, #D4845F);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--color-background-primary);
    color: var(--color-text-primary);
    padding: 16px;
    line-height: 1.5;
  }
  .header { margin-bottom: 16px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header p { font-size: 13px; color: var(--color-text-secondary); }
  #frontier-list { display: flex; flex-direction: column; gap: 10px; }
  .frontier-card {
    background: var(--color-background-secondary);
    border: 1px solid var(--color-border);
    border-radius: 10px; padding: 14px;
    display: flex; align-items: center; gap: 12px;
  }
  .card-info { flex: 1; }
  .card-name { font-size: 15px; font-weight: 600; }
  .card-meta { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
  .importance-tag {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    font-weight: 600; text-transform: capitalize;
  }
  .readiness { font-size: 12px; color: var(--color-text-secondary); }
  .start-btn {
    background: var(--color-accent); color: #fff;
    border: none; border-radius: 8px;
    padding: 8px 16px; font-size: 13px; font-weight: 600;
    cursor: pointer; white-space: nowrap;
    transition: opacity 0.15s;
  }
  .start-btn:hover { opacity: 0.85; }
  .start-btn:disabled { opacity: 0.5; cursor: default; }
  .empty-state {
    text-align: center; padding: 40px 16px;
    color: var(--color-text-secondary); font-size: 14px;
  }
  .loading { text-align: center; color: var(--color-text-secondary); padding: 40px; }
</style>
</head>
<body>
<div class="header">
  <h1>Learning Frontier</h1>
  <p>Concepts you are ready to learn next</p>
</div>
<div id="frontier-list"><div class="loading">Loading...</div></div>

<script>
${runtime}

(function() {
  'use strict';

  function importanceColor(importance) {
    if (importance === 'core') return 'var(--color-accent)';
    if (importance === 'supporting') return 'var(--color-orange)';
    return 'var(--color-text-secondary)';
  }

  function renderFrontier(container, concepts) {
    while (container.firstChild) container.removeChild(container.firstChild);

    if (!concepts || concepts.length === 0) {
      var empty = document.createElement('div');
      empty.setAttribute('class', 'empty-state');
      empty.textContent = 'No frontier concepts available. Keep working to discover new topics!';
      container.appendChild(empty);
      return;
    }

    concepts.forEach(function(c) {
      var card = document.createElement('div');
      card.setAttribute('class', 'frontier-card');

      var info = document.createElement('div');
      info.setAttribute('class', 'card-info');

      var name = document.createElement('div');
      name.setAttribute('class', 'card-name');
      name.textContent = c.name || c.conceptId || 'Unknown';
      info.appendChild(name);

      var meta = document.createElement('div');
      meta.setAttribute('class', 'card-meta');

      if (c.importance) {
        var tag = document.createElement('span');
        tag.setAttribute('class', 'importance-tag');
        var tagColor = importanceColor(c.importance);
        tag.setAttribute('style', 'color: ' + tagColor + '; background: ' + tagColor + '20');
        tag.textContent = c.importance;
        meta.appendChild(tag);
      }

      var readiness = document.createElement('span');
      readiness.setAttribute('class', 'readiness');
      var readinessPct = Math.round((c.readiness || 0) * 100);
      readiness.textContent = readinessPct + '% ready';
      meta.appendChild(readiness);

      info.appendChild(meta);
      card.appendChild(info);

      var btn = document.createElement('button');
      btn.setAttribute('class', 'start-btn');
      btn.textContent = 'Start Learning';
      btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Starting...';
        EntendiApp.callTool('entendi_start_tutor', {
          conceptId: c.conceptId || c.id
        }).then(function() {
          btn.textContent = 'Started!';
        }).catch(function() {
          btn.disabled = false;
          btn.textContent = 'Start Learning';
        });
      });
      card.appendChild(btn);

      container.appendChild(card);
    });
  }

  function handleFrontierData(data) {
    if (!data) return;
    var concepts = data.frontier || data.concepts || [];
    concepts.sort(function(a, b) { return (b.readiness || 0) - (a.readiness || 0); });
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
      } catch (e) { /* ignore parse errors */ }
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
