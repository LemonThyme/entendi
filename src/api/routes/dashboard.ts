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
    h1 { color: #58a6ff; font-size: 1.8rem; margin-bottom: 1.5rem; }
    .stats-row { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
    .stat-card {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 1.25rem 1.5rem; min-width: 160px; flex: 1;
    }
    .stat-value { font-size: 2rem; font-weight: 700; color: #58a6ff; }
    .stat-label { font-size: 0.85rem; color: #8b949e; margin-top: 0.25rem; }
    h2 { color: #c9d1d9; font-size: 1.3rem; margin-bottom: 1rem; }
    .concepts-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem;
    }
    .concept-card {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.25rem;
    }
    .concept-name { font-size: 1.05rem; font-weight: 600; color: #c9d1d9; margin-bottom: 0.25rem; }
    .concept-meta { font-size: 0.8rem; color: #8b949e; margin-bottom: 0.75rem; }
    .mastery-bar-bg {
      width: 100%; height: 8px; background: #21262d; border-radius: 4px; overflow: hidden; margin-bottom: 0.35rem;
    }
    .mastery-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
    .mastery-text { font-size: 0.8rem; color: #8b949e; }
    .loading { color: #8b949e; font-style: italic; }
    .auth-banner {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 1.5rem; margin-bottom: 2rem; text-align: center;
    }
    .auth-banner input, .auth-banner button {
      padding: 0.5rem 1rem; margin: 0.25rem; border-radius: 4px; border: 1px solid #30363d;
      background: #21262d; color: #c9d1d9; font-size: 0.9rem;
    }
    .auth-banner button {
      background: #238636; border-color: #238636; cursor: pointer; font-weight: 600;
    }
    .auth-banner button:hover { background: #2ea043; }
    .auth-banner .secondary { background: #21262d; border-color: #30363d; }
    .user-info {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      padding: 0.75rem 1rem; margin-bottom: 1.5rem; display: flex;
      justify-content: space-between; align-items: center;
    }
    .user-info button {
      padding: 0.35rem 0.75rem; border-radius: 4px; border: 1px solid #30363d;
      background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 0.8rem;
    }
    .filter-row { margin-bottom: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .filter-btn {
      padding: 0.35rem 0.75rem; border-radius: 12px; border: 1px solid #30363d;
      background: #21262d; color: #8b949e; cursor: pointer; font-size: 0.8rem;
    }
    .filter-btn.active { background: #388bfd26; color: #58a6ff; border-color: #388bfd; }
    .section { margin-bottom: 2rem; }
    .error-text { color: #f85149; margin-top: 0.5rem; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>Entendi Dashboard</h1>
  <div id="auth-area"></div>
  <div id="content" style="display:none;">
    <div class="stats-row" id="stats-row"></div>
    <div class="section">
      <h2>Knowledge Graph</h2>
      <div class="filter-row" id="filter-row"></div>
      <div class="concepts-grid" id="concepts-grid"></div>
    </div>
  </div>

  <script>
    (function() {
      "use strict";
      var token = localStorage.getItem("entendi_token");
      var currentUser = null;

      function getHeaders() {
        var h = { "Content-Type": "application/json" };
        if (token) h["Authorization"] = "Bearer " + token;
        return h;
      }

      function pMastery(mu) { return 1 / (1 + Math.exp(-mu)); }

      function masteryColor(pct) {
        if (pct < 0) return "#484f58";
        if (pct < 40) return "#f85149";
        if (pct < 70) return "#d29922";
        return "#3fb950";
      }

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

      function createConceptCard(concept, state) {
        var card = document.createElement("div");
        card.className = "concept-card";

        var nameEl = document.createElement("div");
        nameEl.className = "concept-name";
        nameEl.textContent = concept.id;

        var metaEl = document.createElement("div");
        metaEl.className = "concept-meta";
        metaEl.textContent = concept.domain + " / " + concept.specificity;

        var barBg = document.createElement("div");
        barBg.className = "mastery-bar-bg";
        var barFill = document.createElement("div");
        barFill.className = "mastery-bar-fill";

        var masteryText = document.createElement("div");
        masteryText.className = "mastery-text";

        if (state) {
          var pct = Math.round(pMastery(state.mu) * 100);
          barFill.style.width = pct + "%";
          barFill.style.background = masteryColor(pct);
          masteryText.textContent = pct + "% mastery (" + state.assessmentCount + " assessments)";
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

      // --- Auth UI ---

      function showAuth() {
        var area = document.getElementById("auth-area");
        area.textContent = "";

        var banner = document.createElement("div");
        banner.className = "auth-banner";

        var msg = document.createElement("div");
        msg.style.marginBottom = "1rem";
        msg.style.color = "#8b949e";
        msg.textContent = "Sign in to view your knowledge graph";
        banner.appendChild(msg);

        var row = document.createElement("div");
        var emailInput = document.createElement("input");
        emailInput.type = "email";
        emailInput.placeholder = "Email";
        emailInput.id = "auth-email";

        var passInput = document.createElement("input");
        passInput.type = "password";
        passInput.placeholder = "Password";
        passInput.id = "auth-pass";

        var signInBtn = document.createElement("button");
        signInBtn.textContent = "Sign In";
        signInBtn.onclick = function() { doAuth("/api/auth/sign-in/email"); };

        var signUpBtn = document.createElement("button");
        signUpBtn.className = "secondary";
        signUpBtn.textContent = "Sign Up";
        signUpBtn.onclick = function() { doAuth("/api/auth/sign-up/email"); };

        row.appendChild(emailInput);
        row.appendChild(passInput);
        row.appendChild(signInBtn);
        row.appendChild(signUpBtn);
        banner.appendChild(row);

        var errorEl = document.createElement("div");
        errorEl.className = "error-text";
        errorEl.id = "auth-error";
        banner.appendChild(errorEl);

        area.appendChild(banner);
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
              document.getElementById("auth-error").textContent = data.message || "Auth failed";
            }
          })
          .catch(function() {
            document.getElementById("auth-error").textContent = "Network error";
          });
      }

      function showDashboard() {
        var area = document.getElementById("auth-area");
        area.textContent = "";

        var info = document.createElement("div");
        info.className = "user-info";

        var span = document.createElement("span");
        span.textContent = "Signed in as ";
        var strong = document.createElement("strong");
        strong.textContent = currentUser ? (currentUser.name || currentUser.email) : "User";
        span.appendChild(strong);

        var signOutBtn = document.createElement("button");
        signOutBtn.textContent = "Sign Out";
        signOutBtn.onclick = function() {
          localStorage.removeItem("entendi_token");
          token = null;
          location.reload();
        };

        info.appendChild(span);
        info.appendChild(signOutBtn);
        area.appendChild(info);

        document.getElementById("content").style.display = "block";
        loadData();
      }

      // --- Data loading ---

      function loadData() {
        fetch("/api/concepts", { headers: getHeaders() })
          .then(function(r) { return r.json(); })
          .then(function(concepts) {
            fetch("/api/mastery", { headers: getHeaders() })
              .then(function(r) { return r.json(); })
              .then(function(mastery) {
                renderDashboard(concepts, mastery);
              });
          });

        fetch("/api/mcp/status", { headers: getHeaders() })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var container = document.getElementById("stats-row");
            container.textContent = "";
            if (data.overview) {
              container.appendChild(createStatCard("Total Concepts", data.overview.totalConcepts));
              container.appendChild(createStatCard("Mastered", data.overview.mastered));
              container.appendChild(createStatCard("In Progress", data.overview.inProgress));
              container.appendChild(createStatCard("Unknown", data.overview.unknown));
            }
          });
      }

      function renderDashboard(concepts, mastery) {
        var container = document.getElementById("concepts-grid");
        container.textContent = "";

        var masteryMap = {};
        for (var i = 0; i < mastery.length; i++) {
          masteryMap[mastery[i].conceptId] = mastery[i];
        }

        var domains = {};
        concepts.forEach(function(c) { domains[c.domain] = true; });
        var filterRow = document.getElementById("filter-row");
        filterRow.textContent = "";

        var allBtn = document.createElement("button");
        allBtn.className = "filter-btn active";
        allBtn.textContent = "All";
        allBtn.onclick = function() { renderConcepts(concepts, masteryMap, null); setActiveFilter(allBtn); };
        filterRow.appendChild(allBtn);

        Object.keys(domains).sort().forEach(function(d) {
          var btn = document.createElement("button");
          btn.className = "filter-btn";
          btn.textContent = d;
          btn.onclick = function() { renderConcepts(concepts, masteryMap, d); setActiveFilter(btn); };
          filterRow.appendChild(btn);
        });

        renderConcepts(concepts, masteryMap, null);
      }

      function setActiveFilter(activeBtn) {
        var btns = document.querySelectorAll(".filter-btn");
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");
        activeBtn.classList.add("active");
      }

      function renderConcepts(concepts, masteryMap, domainFilter) {
        var container = document.getElementById("concepts-grid");
        container.textContent = "";

        var filtered = domainFilter
          ? concepts.filter(function(c) { return c.domain === domainFilter; })
          : concepts;

        filtered.sort(function(a, b) {
          var ma = masteryMap[a.id], mb = masteryMap[b.id];
          if (ma && !mb) return -1;
          if (!ma && mb) return 1;
          if (ma && mb) return pMastery(mb.mu) - pMastery(ma.mu);
          return a.id.localeCompare(b.id);
        });

        filtered.forEach(function(concept) {
          container.appendChild(createConceptCard(concept, masteryMap[concept.id] || null));
        });

        if (filtered.length === 0) {
          var empty = document.createElement("div");
          empty.className = "loading";
          empty.textContent = "No concepts found.";
          container.appendChild(empty);
        }
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
