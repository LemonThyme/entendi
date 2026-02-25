import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeGraphState } from '../schemas/types.js';
import { createEmptyGraphState, pMastery } from '../schemas/types.js';

export function createDashboardApp(projectDir: string) {
  const app = new Hono();
  const dataDir = join(projectDir, '.entendi');

  function loadGraph(): KnowledgeGraphState {
    const file = join(dataDir, 'knowledge-graph.json');
    if (!existsSync(file)) return createEmptyGraphState();
    try {
      return JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      return createEmptyGraphState();
    }
  }

  app.get('/api/graph', (c) => c.json(loadGraph()));

  app.get('/api/stats', (c) => {
    const graph = loadGraph();
    const userKeys = new Set(Object.values(graph.userStates).map(s => s.userId));
    return c.json({
      totalConcepts: Object.keys(graph.concepts).length,
      totalUsers: userKeys.size,
      totalAssessments: Object.values(graph.userStates).reduce(
        (sum, s) => sum + s.assessmentCount,
        0,
      ),
    });
  });

  app.get('/', (c) => c.html(getDashboardHTML()));

  return app;
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Entendi Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      min-height: 100vh;
      padding: 2rem;
    }
    h1 {
      color: #58a6ff;
      font-size: 1.8rem;
      margin-bottom: 1.5rem;
    }
    .stats-row {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }
    .stat-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.25rem 1.5rem;
      min-width: 160px;
      flex: 1;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: #58a6ff;
    }
    .stat-label {
      font-size: 0.85rem;
      color: #8b949e;
      margin-top: 0.25rem;
    }
    h2 {
      color: #c9d1d9;
      font-size: 1.3rem;
      margin-bottom: 1rem;
    }
    .concepts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }
    .concept-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1rem 1.25rem;
    }
    .concept-name {
      font-size: 1.05rem;
      font-weight: 600;
      color: #c9d1d9;
      margin-bottom: 0.25rem;
    }
    .concept-meta {
      font-size: 0.8rem;
      color: #8b949e;
      margin-bottom: 0.75rem;
    }
    .mastery-bar-bg {
      width: 100%;
      height: 8px;
      background: #21262d;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 0.35rem;
    }
    .mastery-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .mastery-text {
      font-size: 0.8rem;
      color: #8b949e;
    }
    .loading {
      color: #8b949e;
      font-style: italic;
    }
  </style>
</head>
<body>
  <h1 id="page-title">Entendi Dashboard</h1>
  <div class="stats-row" id="stats-row"></div>
  <h2 id="concepts-heading">Concepts</h2>
  <div class="concepts-grid" id="concepts-grid"></div>

  <script>
    (function() {
      "use strict";

      function createStatCard(label, value) {
        var card = document.createElement("div");
        card.className = "stat-card";
        var valEl = document.createElement("div");
        valEl.className = "stat-value";
        valEl.textContent = String(value);
        var labelEl = document.createElement("div");
        labelEl.className = "stat-label";
        labelEl.textContent = label;
        card.appendChild(valEl);
        card.appendChild(labelEl);
        return card;
      }

      function masteryColor(pct) {
        if (pct < 0) return "#484f58";
        if (pct < 40) return "#f85149";
        if (pct < 70) return "#d29922";
        return "#3fb950";
      }

      function pMastery(mu) {
        return 1 / (1 + Math.exp(-mu));
      }

      function createConceptCard(concept, userState) {
        var card = document.createElement("div");
        card.className = "concept-card";

        var nameEl = document.createElement("div");
        nameEl.className = "concept-name";
        nameEl.textContent = concept.conceptId;

        var metaEl = document.createElement("div");
        metaEl.className = "concept-meta";
        metaEl.textContent = concept.domain + " / " + concept.specificity;

        var barBg = document.createElement("div");
        barBg.className = "mastery-bar-bg";
        var barFill = document.createElement("div");
        barFill.className = "mastery-bar-fill";

        var masteryText = document.createElement("div");
        masteryText.className = "mastery-text";

        if (userState) {
          var pct = Math.round(pMastery(userState.mastery.mu) * 100);
          barFill.style.width = pct + "%";
          barFill.style.background = masteryColor(pct);
          masteryText.textContent = pct + "% mastery (" + userState.assessmentCount + " assessments)";
        } else {
          barFill.style.width = "0%";
          barFill.style.background = masteryColor(-1);
          masteryText.textContent = "Unassessed";
        }

        barBg.appendChild(barFill);
        card.appendChild(nameEl);
        card.appendChild(metaEl);
        card.appendChild(barBg);
        card.appendChild(masteryText);

        return card;
      }

      function showLoading(container) {
        var el = document.createElement("div");
        el.className = "loading";
        el.textContent = "Loading...";
        container.appendChild(el);
        return el;
      }

      function loadStats() {
        var container = document.getElementById("stats-row");
        var loadingEl = showLoading(container);

        fetch("/api/stats")
          .then(function(res) { return res.json(); })
          .then(function(data) {
            container.removeChild(loadingEl);
            container.appendChild(createStatCard("Total Concepts", data.totalConcepts));
            container.appendChild(createStatCard("Total Users", data.totalUsers));
            container.appendChild(createStatCard("Total Assessments", data.totalAssessments));
          })
          .catch(function(err) {
            loadingEl.textContent = "Failed to load stats";
          });
      }

      function loadGraph() {
        var container = document.getElementById("concepts-grid");
        var loadingEl = showLoading(container);

        fetch("/api/graph")
          .then(function(res) { return res.json(); })
          .then(function(data) {
            container.removeChild(loadingEl);

            var conceptIds = Object.keys(data.concepts);
            if (conceptIds.length === 0) {
              var emptyEl = document.createElement("div");
              emptyEl.className = "loading";
              emptyEl.textContent = "No concepts found. Start using Entendi to build your knowledge graph.";
              container.appendChild(emptyEl);
              return;
            }

            // Build a lookup from conceptId to best user state
            var userStatesMap = {};
            var stateKeys = Object.keys(data.userStates);
            for (var i = 0; i < stateKeys.length; i++) {
              var state = data.userStates[stateKeys[i]];
              userStatesMap[state.conceptId] = state;
            }

            // Sort concepts: assessed first (by mastery desc), then unassessed alphabetically
            conceptIds.sort(function(a, b) {
              var stateA = userStatesMap[a];
              var stateB = userStatesMap[b];
              if (stateA && !stateB) return -1;
              if (!stateA && stateB) return 1;
              if (stateA && stateB) {
                return pMastery(stateB.mastery.mu) - pMastery(stateA.mastery.mu);
              }
              return a.localeCompare(b);
            });

            for (var j = 0; j < conceptIds.length; j++) {
              var concept = data.concepts[conceptIds[j]];
              var userState = userStatesMap[conceptIds[j]] || null;
              container.appendChild(createConceptCard(concept, userState));
            }
          })
          .catch(function(err) {
            loadingEl.textContent = "Failed to load knowledge graph";
          });
      }

      loadStats();
      loadGraph();
    })();
  </script>
</body>
</html>`;
}
