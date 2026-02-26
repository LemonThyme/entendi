import { Hono } from 'hono';
import type { Env } from '../index.js';

export const dashboardRoutes = new Hono<Env>();

dashboardRoutes.get('/', (c) => {
  return c.html(getDashboardHTML());
});

// NOTE: All dynamic content in the dashboard frontend uses textContent or
// safe DOM construction (createElement + textContent). No innerHTML with
// untrusted data — concept IDs and domain names come from the API but are
// rendered via textContent, not innerHTML. The only innerHTML usage is for
// static UI chrome (buttons, labels) with hardcoded strings.

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Entendi</title>
  <style>
    :root {
      --bg: #fafafa;
      --bg-card: #ffffff;
      --border: #e5e7eb;
      --border-hover: #d1d5db;
      --text: #111827;
      --text-secondary: #6b7280;
      --text-tertiary: #9ca3af;
      --accent: #2563eb;
      --accent-light: #eff6ff;
      --green: #16a34a;
      --green-bg: #f0fdf4;
      --amber: #d97706;
      --amber-bg: #fffbeb;
      --red: #dc2626;
      --red-bg: #fef2f2;
      --mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    /* Layout */
    .container { max-width: 1080px; margin: 0 auto; padding: 2.5rem 1.5rem; }
    .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2rem; }
    .header h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
    .header-meta { font-size: 0.8rem; color: var(--text-tertiary); }

    /* Auth */
    .auth-container {
      max-width: 360px; margin: 6rem auto; padding: 2rem;
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
    }
    .auth-container h2 { font-size: 1.1rem; margin-bottom: 0.25rem; }
    .auth-subtitle { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem; }
    .form-group { margin-bottom: 0.75rem; }
    .form-group label { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem; font-weight: 500; }
    .form-group input {
      width: 100%; padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 6px;
      font-size: 0.9rem; background: var(--bg); color: var(--text); outline: none;
    }
    .form-group input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    .btn-primary {
      width: 100%; padding: 0.55rem; border: none; border-radius: 6px;
      background: var(--accent); color: white; font-size: 0.85rem; font-weight: 600;
      cursor: pointer; margin-top: 0.5rem;
    }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-link { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 0.8rem; margin-top: 0.75rem; }
    .error-text { color: var(--red); font-size: 0.8rem; margin-top: 0.5rem; }

    /* User bar */
    .user-bar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0; margin-bottom: 2rem; border-bottom: 1px solid var(--border);
      font-size: 0.8rem; color: var(--text-secondary);
    }
    .user-bar button {
      background: none; border: none; color: var(--text-tertiary); cursor: pointer;
      font-size: 0.8rem;
    }
    .user-bar button:hover { color: var(--text); }

    /* Stats */
    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2.5rem; }
    .stat-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px;
      padding: 1rem 1.25rem;
    }
    .stat-value { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
    .stat-label { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .stat-value.green { color: var(--green); }
    .stat-value.amber { color: var(--amber); }
    .stat-value.accent { color: var(--accent); }

    /* Sections */
    .section { margin-bottom: 2.5rem; }
    .section-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1rem; }
    .section-title { font-size: 0.95rem; font-weight: 600; }
    .section-subtitle { font-size: 0.75rem; color: var(--text-tertiary); }

    /* Filters */
    .filter-row { display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .filter-btn {
      padding: 0.3rem 0.65rem; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg-card); color: var(--text-secondary); cursor: pointer;
      font-size: 0.75rem; font-weight: 500; transition: all 0.15s;
    }
    .filter-btn:hover { border-color: var(--border-hover); color: var(--text); }
    .filter-btn.active { background: var(--accent); color: white; border-color: var(--accent); }

    /* Concept list */
    .concept-list { display: flex; flex-direction: column; gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .concept-row {
      display: grid; grid-template-columns: 1fr 120px 80px 60px;
      align-items: center; padding: 0.6rem 1rem; background: var(--bg-card);
      font-size: 0.85rem; gap: 1rem;
    }
    .concept-row:hover { background: #f9fafb; }
    .concept-name { font-family: var(--mono); font-size: 0.8rem; font-weight: 500; color: var(--text); }
    .concept-domain { font-size: 0.7rem; color: var(--text-tertiary); margin-top: 0.1rem; }
    .mastery-cell { display: flex; align-items: center; gap: 0.5rem; }
    .mastery-bar-bg { flex: 1; height: 6px; background: #f3f4f6; border-radius: 3px; overflow: hidden; }
    .mastery-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
    .mastery-pct { font-size: 0.75rem; font-weight: 600; min-width: 32px; text-align: right; font-variant-numeric: tabular-nums; }
    .confidence-cell { font-size: 0.7rem; color: var(--text-tertiary); text-align: center; }
    .confidence-high { color: var(--green); }
    .confidence-med { color: var(--amber); }
    .confidence-low { color: var(--text-tertiary); }
    .assessments-cell { font-size: 0.75rem; color: var(--text-tertiary); text-align: right; font-variant-numeric: tabular-nums; }
    .concept-header {
      display: grid; grid-template-columns: 1fr 120px 80px 60px;
      padding: 0.45rem 1rem; font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--text-tertiary); font-weight: 600; gap: 1rem;
    }

    /* Activity table */
    .activity-table { width: 100%; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; border-spacing: 0; }
    .activity-table th {
      text-align: left; padding: 0.5rem 1rem; font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--text-tertiary); font-weight: 600;
      background: #f9fafb; border-bottom: 1px solid var(--border);
    }
    .activity-table td { padding: 0.5rem 1rem; font-size: 0.8rem; border-bottom: 1px solid var(--border); }
    .activity-table tr:last-child td { border-bottom: none; }
    .activity-table tr:hover td { background: #f9fafb; }
    .score-badge {
      display: inline-block; padding: 0.1rem 0.45rem; border-radius: 4px;
      font-size: 0.7rem; font-weight: 600;
    }
    .score-0 { background: var(--red-bg); color: var(--red); }
    .score-1 { background: var(--amber-bg); color: var(--amber); }
    .score-2 { background: var(--green-bg); color: var(--green); }
    .score-3 { background: var(--green-bg); color: var(--green); }
    .event-type { font-size: 0.7rem; color: var(--text-tertiary); }
    .time-ago { font-size: 0.75rem; color: var(--text-tertiary); }

    /* Empty states */
    .empty-state { text-align: center; padding: 2rem; color: var(--text-tertiary); font-size: 0.85rem; }

    /* Responsive */
    @media (max-width: 640px) {
      .stats-row { grid-template-columns: repeat(2, 1fr); }
      .concept-row { grid-template-columns: 1fr 80px; }
      .concept-header { grid-template-columns: 1fr 80px; }
      .confidence-cell, .assessments-cell, .concept-header > *:nth-child(3), .concept-header > *:nth-child(4) { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="auth-area"></div>
    <div id="content" style="display:none;">
      <div class="header">
        <h1>Entendi</h1>
        <div class="header-meta" id="header-meta"></div>
      </div>
      <div id="user-bar"></div>
      <div class="stats-row" id="stats-row"></div>

      <div class="section">
        <div class="section-header">
          <div class="section-title">Knowledge Map</div>
          <div class="section-subtitle" id="concept-count"></div>
        </div>
        <div class="filter-row" id="filter-row"></div>
        <div class="concept-header">
          <div>Concept</div>
          <div>Mastery</div>
          <div style="text-align:center">Confidence</div>
          <div style="text-align:right">Probes</div>
        </div>
        <div class="concept-list" id="concept-list"></div>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-title">Recent Activity</div>
        </div>
        <div id="activity-area"></div>
      </div>
    </div>
  </div>

  <script>
    (function() {
      "use strict";
      var token = localStorage.getItem("entendi_token");
      var currentUser = null;

      function h(tag, attrs, children) {
        var el = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function(k) {
          if (k === "className") el.className = attrs[k];
          else if (k === "onclick") el.onclick = attrs[k];
          else if (k.indexOf("style") === 0) el.style[k.replace("style","").toLowerCase() || "cssText"] = attrs[k];
          else el.setAttribute(k, attrs[k]);
        });
        if (children !== undefined) {
          if (typeof children === "string") el.textContent = children;
          else if (Array.isArray(children)) children.forEach(function(c) { if (c) el.appendChild(c); });
          else el.appendChild(children);
        }
        return el;
      }

      function getHeaders() {
        var headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = "Bearer " + token;
        return headers;
      }

      function pMastery(mu) { return 1 / (1 + Math.exp(-mu)); }

      function masteryColor(pct) {
        if (pct < 0) return "#e5e7eb";
        if (pct < 30) return "#dc2626";
        if (pct < 60) return "#d97706";
        return "#16a34a";
      }

      function confidenceLabel(sigma, count) {
        if (count === 0) return { text: "\u2014", cls: "confidence-low" };
        if (sigma < 0.4) return { text: "High", cls: "confidence-high" };
        if (sigma < 0.8) return { text: "Med", cls: "confidence-med" };
        return { text: "Low", cls: "confidence-low" };
      }

      function timeAgo(dateStr) {
        if (!dateStr) return "\u2014";
        var diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
        if (diff < 60) return "just now";
        if (diff < 3600) return Math.floor(diff / 60) + "m ago";
        if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
        return Math.floor(diff / 86400) + "d ago";
      }

      // --- Auth ---

      function showAuth() {
        var area = document.getElementById("auth-area");
        area.textContent = "";

        var box = h("div", { className: "auth-container" }, [
          h("h2", null, "Sign in to Entendi"),
          h("div", { className: "auth-subtitle" }, "View your knowledge graph and mastery data"),
          h("div", { className: "form-group" }, [
            h("label", null, "Email"),
            h("input", { type: "email", id: "auth-email", placeholder: "you@example.com" })
          ]),
          h("div", { className: "form-group" }, [
            h("label", null, "Password"),
            h("input", { type: "password", id: "auth-pass", placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" })
          ]),
          h("button", { className: "btn-primary", onclick: function() { doAuth("/api/auth/sign-in/email"); } }, "Sign In"),
          h("button", { className: "btn-link", onclick: function() { doAuth("/api/auth/sign-up/email"); } }, "Create account"),
          h("div", { className: "error-text", id: "auth-error" })
        ]);
        area.appendChild(box);
      }

      function doAuth(url) {
        var email = document.getElementById("auth-email").value;
        var pass = document.getElementById("auth-pass").value;
        var body = { email: email, password: pass };
        if (url.indexOf("sign-up") !== -1) body.name = email.split("@")[0];

        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.token) {
              token = data.token;
              localStorage.setItem("entendi_token", token);
              currentUser = data.user;
              showDashboard();
            } else {
              document.getElementById("auth-error").textContent = data.message || "Authentication failed";
            }
          })
          .catch(function() {
            document.getElementById("auth-error").textContent = "Network error \u2014 is the API running?";
          });
      }

      // --- Dashboard ---

      function showDashboard() {
        document.getElementById("auth-area").textContent = "";
        document.getElementById("content").style.display = "block";

        var bar = document.getElementById("user-bar");
        bar.textContent = "";
        var userBar = h("div", { className: "user-bar" }, [
          h("span", null, currentUser ? (currentUser.name || currentUser.email) : "User"),
          h("button", { onclick: function() { localStorage.removeItem("entendi_token"); token = null; location.reload(); } }, "Sign out")
        ]);
        bar.appendChild(userBar);

        loadData();
      }

      function loadData() {
        Promise.all([
          fetch("/api/concepts", { headers: getHeaders() }).then(function(r) { return r.json(); }),
          fetch("/api/mastery", { headers: getHeaders() }).then(function(r) { return r.json(); }),
          fetch("/api/mcp/status", { headers: getHeaders() }).then(function(r) { return r.json(); }),
        ]).then(function(results) {
          renderStats(results[2]);
          renderConcepts(results[0], results[1]);
          loadActivity();
        });
      }

      function renderStats(statusData) {
        var container = document.getElementById("stats-row");
        container.textContent = "";
        if (!statusData.overview) return;
        var o = statusData.overview;

        function statCard(value, label, colorCls) {
          var card = h("div", { className: "stat-card" }, [
            h("div", { className: "stat-value" + (colorCls ? " " + colorCls : "") }, String(value)),
            h("div", { className: "stat-label" }, label)
          ]);
          return card;
        }

        container.appendChild(statCard(o.totalConcepts, "Total Concepts", ""));
        container.appendChild(statCard(o.mastered, "Mastered", "green"));
        container.appendChild(statCard(o.inProgress, "In Progress", "amber"));
        container.appendChild(statCard(o.unknown, "Unassessed", "accent"));
      }

      var allConcepts = [], allMasteryMap = {};

      function renderConcepts(concepts, mastery) {
        allConcepts = concepts;
        allMasteryMap = {};
        for (var i = 0; i < mastery.length; i++) {
          allMasteryMap[mastery[i].conceptId] = mastery[i];
        }

        // Build domain filters
        var domains = {};
        concepts.forEach(function(c) { domains[c.domain] = true; });
        var filterRow = document.getElementById("filter-row");
        filterRow.textContent = "";

        var allBtn = h("button", { className: "filter-btn active", onclick: function() { renderConceptList(null); setActive(allBtn); } }, "All");
        filterRow.appendChild(allBtn);

        Object.keys(domains).sort().forEach(function(d) {
          var btn = h("button", { className: "filter-btn", onclick: function() { renderConceptList(d); setActive(btn); } }, d);
          filterRow.appendChild(btn);
        });

        renderConceptList(null);
      }

      function setActive(activeBtn) {
        var btns = document.querySelectorAll(".filter-btn");
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");
        activeBtn.classList.add("active");
      }

      function renderConceptList(domainFilter) {
        var container = document.getElementById("concept-list");
        container.textContent = "";

        var filtered = domainFilter
          ? allConcepts.filter(function(c) { return c.domain === domainFilter; })
          : allConcepts;

        // Sort: assessed first (by mastery desc), then unassessed alphabetically
        filtered.sort(function(a, b) {
          var ma = allMasteryMap[a.id], mb = allMasteryMap[b.id];
          if (ma && !mb) return -1;
          if (!ma && mb) return 1;
          if (ma && mb) return pMastery(mb.mu) - pMastery(ma.mu);
          return a.id.localeCompare(b.id);
        });

        document.getElementById("concept-count").textContent = filtered.length + " concepts";

        if (filtered.length === 0) {
          container.appendChild(h("div", { className: "empty-state" }, "No concepts found."));
          return;
        }

        filtered.forEach(function(concept) {
          var state = allMasteryMap[concept.id];
          var pct = state ? Math.round(pMastery(state.mu) * 100) : -1;
          var sigma = state ? state.sigma : 1.5;
          var count = state ? state.assessmentCount : 0;
          var conf = confidenceLabel(sigma, count);

          var row = h("div", { className: "concept-row" }, [
            h("div", null, [
              h("div", { className: "concept-name" }, concept.id),
              h("div", { className: "concept-domain" }, concept.domain)
            ]),
            h("div", { className: "mastery-cell" }, [
              h("div", { className: "mastery-bar-bg" }, [
                (function() {
                  var fill = h("div", { className: "mastery-bar-fill" });
                  fill.style.width = (pct >= 0 ? pct : 0) + "%";
                  fill.style.background = masteryColor(pct);
                  return fill;
                })()
              ]),
              h("div", { className: "mastery-pct" }, pct >= 0 ? pct + "%" : "\u2014")
            ]),
            h("div", { className: "confidence-cell " + conf.cls }, conf.text),
            h("div", { className: "assessments-cell" }, count > 0 ? String(count) : "\u2014")
          ]);

          container.appendChild(row);
        });
      }

      function loadActivity() {
        // Fetch recent assessment events via mastery history for assessed concepts
        var assessed = Object.keys(allMasteryMap);
        if (assessed.length === 0) {
          document.getElementById("activity-area").appendChild(
            h("div", { className: "empty-state" }, "No assessments yet. Start using AI tools with Entendi active.")
          );
          return;
        }

        // Fetch history for the most recently assessed concepts
        var sorted = assessed
          .filter(function(id) { return allMasteryMap[id].lastAssessed; })
          .sort(function(a, b) {
            return new Date(allMasteryMap[b].lastAssessed).getTime() - new Date(allMasteryMap[a].lastAssessed).getTime();
          })
          .slice(0, 5);

        if (sorted.length === 0) {
          document.getElementById("activity-area").appendChild(
            h("div", { className: "empty-state" }, "No assessment history yet.")
          );
          return;
        }

        Promise.all(sorted.map(function(conceptId) {
          return fetch("/api/mastery/" + encodeURIComponent(conceptId) + "/history", { headers: getHeaders() })
            .then(function(r) { return r.json(); })
            .then(function(events) { return events.map(function(e) { e._conceptId = conceptId; return e; }); });
        })).then(function(results) {
          var allEvents = [].concat.apply([], results);
          allEvents.sort(function(a, b) { return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); });
          allEvents = allEvents.slice(0, 15);
          renderActivity(allEvents);
        });
      }

      function renderActivity(events) {
        var area = document.getElementById("activity-area");
        area.textContent = "";

        if (events.length === 0) {
          area.appendChild(h("div", { className: "empty-state" }, "No assessment history yet."));
          return;
        }

        var table = h("table", { className: "activity-table" });
        var thead = h("thead", null, [
          h("tr", null, [
            h("th", null, "Concept"),
            h("th", null, "Type"),
            h("th", null, "Score"),
            h("th", null, "Mastery Change"),
            h("th", null, "When")
          ])
        ]);
        table.appendChild(thead);

        var tbody = h("tbody");
        events.forEach(function(ev) {
          var conceptId = ev._conceptId || ev.conceptId;
          var pBefore = Math.round(pMastery(ev.muBefore) * 100);
          var pAfter = Math.round(pMastery(ev.muAfter) * 100);
          var delta = pAfter - pBefore;
          var deltaStr = (delta >= 0 ? "+" : "") + delta + "%";
          var deltaColor = delta > 0 ? "var(--green)" : delta < 0 ? "var(--red)" : "var(--text-tertiary)";

          var typeLabel = ev.eventType === "probe" ? "Probe"
            : ev.eventType === "tutor_phase1" ? "Tutor P1"
            : ev.eventType === "tutor_phase4" ? "Tutor P4"
            : ev.eventType;

          var row = h("tr", null, [
            h("td", null, h("span", { className: "concept-name" }, conceptId)),
            h("td", null, h("span", { className: "event-type" }, typeLabel)),
            h("td", null, h("span", { className: "score-badge score-" + ev.rubricScore }, String(ev.rubricScore) + "/3")),
            h("td", null, (function() {
              var span = h("span", null, pBefore + "% \u2192 " + pAfter + "%  ");
              var deltaSpan = h("span", null, deltaStr);
              deltaSpan.style.color = deltaColor;
              deltaSpan.style.fontWeight = "600";
              span.appendChild(deltaSpan);
              return span;
            })()),
            h("td", null, h("span", { className: "time-ago" }, timeAgo(ev.createdAt)))
          ]);
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        area.appendChild(table);
      }

      // --- Init ---
      if (token) {
        fetch("/api/me", { headers: getHeaders() })
          .then(function(r) {
            if (r.ok) return r.json();
            throw new Error("Unauthorized");
          })
          .then(function(data) { currentUser = data.user; showDashboard(); })
          .catch(function() { localStorage.removeItem("entendi_token"); token = null; showAuth(); });
      } else {
        showAuth();
      }
    })();
  </script>
</body>
</html>`;
}
