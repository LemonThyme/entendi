(function() {
  
  var token = localStorage.getItem("entendi_token");
  var currentUser = null;

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k) {
      if (k === "className") el.className = attrs[k];
      else if (k === "onclick") el.onclick = attrs[k];
      else if (k === "onchange") el.onchange = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    if (children !== undefined) {
      if (typeof children === "string") el.textContent = children;
      else if (Array.isArray(children)) children.forEach(function(c) { if (c) el.appendChild(c); });
      else el.appendChild(children);
    }
    return el;
  }

  function cacheGet(key) {
    try { var d = sessionStorage.getItem("entendi_" + key); return d ? JSON.parse(d) : null; } catch(_e) { return null; }
  }
  function cacheSet(key, data) {
    try { sessionStorage.setItem("entendi_" + key, JSON.stringify(data)); } catch(_e) {}
  }
  function cacheClear() {
    try { Object.keys(sessionStorage).forEach(function(k) { if (k.indexOf("entendi_") === 0) sessionStorage.removeItem(k); }); } catch(_e) {}
  }

  function getHeaders() {
    var headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    return headers;
  }

  function pMastery(mu) { return 1 / (1 + Math.exp(-mu)); }

  function masteryColor(pct) {
    if (pct < 0) return "#E0DCD6";
    if (pct < 30) return "#B84233";
    if (pct < 60) return "#B8860B";
    return "#5B7B5E";
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

  function statCard(value, label, colorCls) {
    return h("div", { className: "stat-card" }, [
      h("div", { className: "stat-value" + (colorCls ? " " + colorCls : "") }, String(value)),
      h("div", { className: "stat-label" }, label)
    ]);
  }

  // --- Tabs ---

  function switchTab(btn) {
    var btns = document.querySelectorAll(".tab-btn");
    var tab = btn.getAttribute("data-tab");
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.remove("active");
      btns[j].setAttribute("aria-selected", "false");
      btns[j].setAttribute("tabindex", "-1");
    }
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    btn.setAttribute("tabindex", "0");
    btn.focus();
    document.querySelectorAll(".tab-content").forEach(function(tc) { tc.classList.remove("active"); });
    var target = document.getElementById("tab-" + tab);
    if (target) target.classList.add("active");

    if (tab === "analytics") renderAnalytics();
    if (tab === "concepts") renderConceptsTab();
    if (tab === "integrity") renderIntegrity();
    if (tab === "settings") renderSettings();
    if (tab === "organization") renderOrganization();
  }

  function initTabs() {
    var btns = document.querySelectorAll(".tab-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function() { switchTab(this); });
      btns[i].addEventListener("keydown", function(e) {
        var allBtns = Array.from(document.querySelectorAll(".tab-btn"));
        var idx = allBtns.indexOf(this);
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          var next = allBtns[(idx + 1) % allBtns.length];
          switchTab(next);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          var prev = allBtns[(idx - 1 + allBtns.length) % allBtns.length];
          switchTab(prev);
        } else if (e.key === "Home") {
          e.preventDefault();
          switchTab(allBtns[0]);
        } else if (e.key === "End") {
          e.preventDefault();
          switchTab(allBtns[allBtns.length - 1]);
        }
      });
    }
  }

  // --- Auth ---

  function showAuth() {
    var area = document.getElementById("auth-area");
    area.textContent = "";

    // Clone social buttons from <template> elements (static SVG, safe)
    var ghTpl = document.getElementById("tpl-github-btn");
    var googleTpl = document.getElementById("tpl-google-btn");
    var ghBtn = ghTpl.content.cloneNode(true);
    var googleBtn = googleTpl.content.cloneNode(true);

    var box = h("div", { className: "auth-container" }, [
      h("h2", null, "Sign in to Entendi"),
      h("div", { className: "auth-subtitle" }, "View your knowledge graph and mastery data"),
      h("div", { className: "social-btns" }, [ghBtn, googleBtn]),
      h("div", { className: "divider" }, "or"),
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
      h("button", { onclick: function() { fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "include" }).finally(function() { localStorage.removeItem("entendi_token"); token = null; cacheClear(); location.reload(); }); } }, "Sign out")
    ]);
    bar.appendChild(userBar);

    initTabs();
    loadData();
    connectSSE();
  }

  function applyData(concepts, mastery) {
    allConcepts = concepts;
    allMasteryMap = {};
    for (var i = 0; i < mastery.length; i++) {
      allMasteryMap[mastery[i].conceptId] = mastery[i];
    }
    renderOverviewHero(concepts, mastery);
    loadActivity();
  }

  function loadData() {
    // Stale-while-revalidate: render cached data immediately if available
    var cached = cacheGet("data");
    if (cached) {
      applyData(cached.concepts, cached.mastery);
    }

    // Fetch fresh data in background
    Promise.all([
      fetch("/api/concepts", { headers: getHeaders() }).then(function(r) { return r.json(); }),
      fetch("/api/mastery", { headers: getHeaders() }).then(function(r) { return r.json(); }),
    ]).then(function(results) {
      var fresh = { concepts: results[0], mastery: results[1] };
      var prev = cacheGet("data");
      cacheSet("data", fresh);
      // Re-render if data changed or no cache existed
      if (!prev || JSON.stringify(prev) !== JSON.stringify(fresh)) {
        applyData(fresh.concepts, fresh.mastery);
      }
    });
  }


  function renderOverviewHero(_concepts, mastery) {
    var merged = [];
    for (var i = 0; i < mastery.length; i++) {
      var m = mastery[i];
      var pct = Math.round(pMastery(m.mu) * 100);
      merged.push({ id: m.conceptId, pct: pct, lastAssessed: m.lastAssessed });
    }
    merged.sort(function(a, b) { return a.pct - b.pct; });

    function renderPanel(containerId, title, items, barColor) {
      var container = document.getElementById(containerId);
      if (!container) return;
      container.textContent = "";
      var panel = h("div", { className: "hero-panel" }, [
        h("div", { className: "hero-panel-title" }, title)
      ]);
      if (items.length === 0) {
        panel.appendChild(h("div", { className: "empty-state" }, "No data yet."));
      } else {
        items.forEach(function(item) {
          var barFill = h("div", { className: "hero-concept-bar-fill" });
          barFill.style.width = item.pct + "%";
          barFill.style.background = barColor;
          var displayName = item.id.replace(/-/g, " ").replace(/\//g, " \u203A ");
          var nameEl = h("div", { className: "hero-concept-name", style: "cursor:pointer", onclick: (function(id) { return function() { navigateToConcept(id); }; })(item.id) }, displayName);
          var row = h("div", { className: "hero-concept", role: "listitem" }, [
            nameEl,
            h("div", { className: "hero-concept-bar", role: "progressbar", "aria-valuenow": String(item.pct), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": item.pct + "% mastery" }, [barFill]),
            h("div", { className: "hero-concept-pct", "aria-hidden": "true" }, item.pct + "%"),
            h("div", { className: "hero-concept-meta" }, timeAgo(item.lastAssessed))
          ]);
          panel.appendChild(row);
        });
      }
      container.appendChild(panel);
    }

    var bottom3 = merged.slice(0, 3);
    var top3 = merged.slice(-3).reverse();

    renderPanel("panel-strongest", "Strongest", top3, "#5B7B5E");
    renderPanel("panel-attention", "Needs Attention", bottom3, "#B84233");
  }

  var allConcepts = [], allMasteryMap = {};

  function _renderConcepts(concepts, mastery) {
    allConcepts = concepts;
    allMasteryMap = {};
    for (var i = 0; i < mastery.length; i++) {
      allMasteryMap[mastery[i].conceptId] = mastery[i];
    }

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
    container.setAttribute("role", "list");
    container.setAttribute("aria-label", "Concept mastery list");

    var filtered = domainFilter
      ? allConcepts.filter(function(c) { return c.domain === domainFilter; })
      : allConcepts;

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

      var masteryLabel = pct >= 0 ? pct + "% mastery" : "Not assessed";
      var row = h("div", { className: "concept-row", role: "listitem" }, [
        h("div", null, [
          h("div", { className: "concept-name" }, concept.id),
          h("div", { className: "concept-domain" }, concept.domain)
        ]),
        h("div", { className: "mastery-cell", "aria-label": masteryLabel }, [
          h("div", { className: "mastery-bar-bg", role: "progressbar", "aria-valuenow": String(pct >= 0 ? pct : 0), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": masteryLabel }, [
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
    var assessed = Object.keys(allMasteryMap);
    if (assessed.length === 0) {
      document.getElementById("activity-area").appendChild(
        h("div", { className: "empty-state" }, "No assessments yet. Start using AI tools with Entendi active.")
      );
      return;
    }

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

    // Show skeleton while loading
    var actArea = document.getElementById("activity-area");
    actArea.textContent = "";
    var actSkelTable = h("table", { className: "activity-table" });
    actSkelTable.appendChild(h("thead", {}, h("tr", {}, [
      h("th", {}, "Concept"),
      h("th", {}, "Type"),
      h("th", {}, "Score"),
      h("th", {}, "Mastery"),
      h("th", { style: "text-align:right" }, "When")
    ])));
    var actSkelBody = h("tbody", {});
    for (var si = 0; si < 5; si++) {
      actSkelBody.appendChild(h("tr", {}, [
        h("td", {}, h("div", { className: "skeleton", style: "width:120px;height:14px" })),
        h("td", {}, h("div", { className: "skeleton", style: "width:50px;height:14px" })),
        h("td", {}, h("div", { className: "skeleton", style: "width:30px;height:14px" })),
        h("td", {}, h("div", { className: "skeleton", style: "width:100px;height:14px" })),
        h("td", { style: "text-align:right" }, h("div", { className: "skeleton", style: "width:50px;height:14px;margin-left:auto" }))
      ]));
    }
    actSkelTable.appendChild(actSkelBody);
    actArea.appendChild(actSkelTable);

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
    var thead = h("thead", {}, h("tr", {}, [
      h("th", {}, "Concept"),
      h("th", {}, "Type"),
      h("th", {}, "Score"),
      h("th", {}, "Mastery"),
      h("th", { style: "text-align:right" }, "When")
    ]));
    table.appendChild(thead);

    var tbody = h("tbody", {});
    events.forEach(function(ev) {
      var conceptId = ev._conceptId || ev.conceptId;
      var displayName = conceptId.replace(/-/g, " ").replace(/\//g, " \u203A ");
      var pBefore = Math.round(pMastery(ev.muBefore) * 100);
      var pAfter = Math.round(pMastery(ev.muAfter) * 100);
      var delta = pAfter - pBefore;
      var deltaStr = (delta >= 0 ? "+" : "") + delta + "%";
      var trendCls = delta > 0 ? "trend-up" : delta < 0 ? "trend-down" : "trend-flat";

      var typeLabel = ev.eventType === "probe" ? "Probe"
        : ev.eventType === "tutor_phase1" ? "Tutor P1"
        : ev.eventType === "tutor_phase4" ? "Tutor P4"
        : ev.eventType;

      var deltaSpan = h("span", { className: trendCls, style: "font-weight:600;margin-left:6px" }, deltaStr);

      var masteryCell = h("td", {});
      var masteryText = h("span", { style: "color:var(--text-secondary)" }, pBefore + "% \u2192 " + pAfter + "%");
      masteryText.appendChild(deltaSpan);
      masteryCell.appendChild(masteryText);

      var nameLink = h("span", { className: "concept-name", style: "cursor:pointer;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px", onclick: (function(id) { return function(e) { e.stopPropagation(); navigateToConcept(id); }; })(conceptId) }, displayName);

      var row = h("tr", {}, [
        h("td", {}, nameLink),
        h("td", { className: "event-type" }, typeLabel),
        h("td", {}, h("span", { className: "score-badge score-" + ev.rubricScore }, ev.rubricScore + "/3")),
        masteryCell,
        h("td", { className: "time-ago", style: "text-align:right" }, timeAgo(ev.createdAt))
      ]);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    area.appendChild(table);
  }

  // --- Analytics Tab ---

  function renderAnalytics() {
    if (typeof echarts !== "undefined" && !echarts._warmRegistered) {
      echarts.registerTheme('warm', {
        color: ['#C4704B', '#5B7B5E', '#B8860B', '#7A7268', '#B84233', '#9B9389'],
        backgroundColor: 'transparent',
        textStyle: { fontFamily: "'DM Sans', sans-serif", color: '#7A7268' },
        categoryAxis: { axisLine: { lineStyle: { color: '#E0DCD6' } }, splitLine: { lineStyle: { color: '#E0DCD6' } } },
        valueAxis: { axisLine: { lineStyle: { color: '#E0DCD6' } }, splitLine: { lineStyle: { color: '#E0DCD6' } } },
      });
      echarts._warmRegistered = true;
    }
    renderActivityHeatmap();
    renderVelocityChart();
    renderDomainRadar();
  }


  function renderActivityHeatmap() {
    var container = document.getElementById("analytics-heatmap");
    if (!container || typeof echarts === "undefined") return;

    fetch("/api/analytics/activity-heatmap?days=365", { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var chart = echarts.init(container, 'warm');
        var heatmapData = (data.heatmap || []).map(function(d) {
          return [d.date, d.assessmentCount];
        });

        var year = new Date().getFullYear();
        chart.setOption({
          tooltip: {
            formatter: function(params) {
              return params.value[0] + ": " + params.value[1] + " assessments";
            }
          },
          visualMap: {
            min: 0,
            max: Math.max.apply(null, heatmapData.map(function(d) { return d[1]; }).concat([1])),
            show: false,
            inRange: { color: ["#F6F4F1", "#EDDCD3", "#D4A583", "#C4704B", "#A85D3D"] },
          },
          calendar: {
            top: 20, left: 50, right: 20,
            cellSize: [13, 13],
            range: [year + "-01-01", year + "-12-31"],
            itemStyle: { borderWidth: 2, borderColor: "#F6F4F1" },
            yearLabel: { show: false },
            dayLabel: { nameMap: "en", fontSize: 10 },
            monthLabel: { fontSize: 10 },
          },
          series: [{
            type: "heatmap",
            coordinateSystem: "calendar",
            data: heatmapData,
          }],
        });

        window.addEventListener("resize", function() { chart.resize(); });
      });
  }

  function renderVelocityChart() {
    var container = document.getElementById("analytics-velocity");
    if (!container || typeof echarts === "undefined") return;

    fetch("/api/analytics/timeline", { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var chart = echarts.init(container, 'warm');
        var timeline = data.timeline || [];

        chart.setOption({
          tooltip: { trigger: "axis" },
          xAxis: { type: "category", data: timeline.map(function(t) { return t.date; }) },
          yAxis: { type: "value", name: "Cumulative Mastery Gain", axisLabel: { formatter: "{value}" } },
          series: [{
            type: "line",
            data: timeline.map(function(t) { return t.cumulativeDelta; }),
            smooth: true,
            areaStyle: { opacity: 0.15 },
            lineStyle: { width: 2 },
          }],
          grid: { top: 30, right: 20, bottom: 30, left: 60 },
        });

        window.addEventListener("resize", function() { chart.resize(); });
      });
  }

  function renderDomainRadar() {
    var container = document.getElementById("analytics-radar");
    if (!container || typeof echarts === "undefined") return;

    fetch("/api/mastery", { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(states) {
        return fetch("/api/concepts", { headers: getHeaders() })
          .then(function(r) { return r.json(); })
          .then(function(allConceptsData) {
            var domainMastery = {};
            states.forEach(function(s) {
              var concept = allConceptsData.find(function(c) { return c.id === s.conceptId; });
              var domain = concept ? concept.domain : "unknown";
              if (!domainMastery[domain]) domainMastery[domain] = [];
              domainMastery[domain].push(pMastery(s.mu));
            });

            var domains = Object.keys(domainMastery);
            if (domains.length < 3) return;

            var indicators = domains.map(function(d) { return { name: d, max: 100 }; });
            var values = domains.map(function(d) {
              var masteries = domainMastery[d];
              var avg = masteries.reduce(function(a, b) { return a + b; }, 0) / masteries.length;
              return Math.round(avg * 100);
            });

            var chart = echarts.init(container, 'warm');
            chart.setOption({
              radar: { indicator: indicators, shape: "circle" },
              series: [{
                type: "radar",
                data: [{ value: values, name: "Mastery" }],
                areaStyle: { opacity: 0.15 },
                lineStyle: { width: 2 },
              }],
            });

            window.addEventListener("resize", function() { chart.resize(); });
          });
      });
  }

  // --- Concepts Tab ---

  var _currentConceptDetail = null;

  function navigateToConcept(conceptId) {
    // Switch to concepts tab and open detail
    var conceptsBtn = document.getElementById("tabBtn-concepts");
    if (conceptsBtn) switchTab(conceptsBtn);
    renderConceptsTab(conceptId);
  }

  function renderConceptsTab(autoOpenConceptId) {
    var listContainer = document.getElementById("concepts-list");
    var detailContainer = document.getElementById("concept-detail");
    var countEl = document.getElementById("concepts-count");
    listContainer.textContent = "";
    detailContainer.style.display = "none";

    // Skeleton table
    var skelTable = h("table", { className: "activity-table" });
    skelTable.appendChild(h("thead", {}, h("tr", {}, [
      h("th", {}, "Concept"),
      h("th", {}, "Mastery"),
      h("th", { style: "text-align:center" }, "Confidence"),
      h("th", { style: "text-align:right" }, "Assessments")
    ])));
    var skelBody = h("tbody", {});
    for (var i = 0; i < 6; i++) {
      skelBody.appendChild(h("tr", {}, [
        h("td", {}, h("div", { className: "skeleton", style: "width:120px;height:14px" })),
        h("td", {}, h("div", { className: "skeleton", style: "width:80px;height:14px" })),
        h("td", { style: "text-align:center" }, h("div", { className: "skeleton", style: "width:40px;height:14px;margin:0 auto" })),
        h("td", { style: "text-align:right" }, h("div", { className: "skeleton", style: "width:30px;height:14px;margin-left:auto" }))
      ]));
    }
    skelTable.appendChild(skelBody);
    listContainer.appendChild(skelTable);

    Promise.all([
      fetch("/api/mastery", { headers: getHeaders() }).then(function(r) { return r.json(); }),
      fetch("/api/concepts", { headers: getHeaders() }).then(function(r) { return r.json(); }),
    ]).then(function(results) {
      var states = results[0];
      var allConceptsData = results[1];
      listContainer.textContent = "";

      // Only show concepts the user has state for
      var userConcepts = states.map(function(s) {
        var concept = allConceptsData.find(function(c) { return c.id === s.conceptId; });
        return { state: s, concept: concept };
      }).filter(function(item) { return item.concept; });

      countEl.textContent = userConcepts.length + " concepts assessed";

      var table = h("table", { className: "activity-table" });
      var thead = h("thead", {}, h("tr", {}, [
        h("th", {}, "Concept"),
        h("th", {}, "Mastery"),
        h("th", { style: "text-align:center" }, "Confidence"),
        h("th", { style: "text-align:right" }, "Assessments")
      ]));
      table.appendChild(thead);

      userConcepts.sort(function(a, b) {
        return (b.state.lastAssessed || "").localeCompare(a.state.lastAssessed || "");
      });

      var tbody = h("tbody", {});
      userConcepts.forEach(function(item) {
        var s = item.state;
        var c = item.concept;
        var p = Math.round(pMastery(s.mu) * 100);
        var low = Math.round(pMastery(s.mu - 2 * s.sigma) * 100);
        var high = Math.min(100, Math.round(pMastery(s.mu + 2 * s.sigma) * 100));
        var confidence = s.sigma < 0.3 ? "High" : s.sigma < 0.8 ? "Med" : "Low";
        var displayName = c.id.replace(/-/g, " ").replace(/\//g, " \u203A ");

        var masteryCell = h("td", { "aria-label": p + "% mastery (" + low + "\u2013" + high + "% range)" });
        var barContainer = h("div", { className: "mastery-bar-container", style: "display:inline-block;width:80px;vertical-align:middle", role: "progressbar", "aria-valuenow": String(p), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": p + "% mastery" });
        var bar = h("div", { className: "mastery-bar" });
        bar.style.width = p + "%";
        bar.style.background = masteryColor(p);
        barContainer.appendChild(bar);
        masteryCell.appendChild(barContainer);
        masteryCell.appendChild(h("span", { className: "mastery-range" }, low + "\u2013" + high + "%"));

        var nameCell = h("td", {});
        var nameLink = h("span", { className: "concept-name", style: "cursor:pointer" }, displayName);
        nameCell.appendChild(nameLink);
        if (c.domain) nameCell.appendChild(h("span", { className: "domain-badge" }, c.domain));

        var row = h("tr", { style: "cursor:pointer", onclick: function() { openConceptDetail(s.conceptId); } }, [
          nameCell,
          masteryCell,
          h("td", { style: "text-align:center" }, h("span", { className: "confidence-badge confidence-" + confidence.toLowerCase() }, confidence)),
          h("td", { style: "text-align:right" }, String(s.assessmentCount))
        ]);
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      listContainer.appendChild(table);

      if (autoOpenConceptId) openConceptDetail(autoOpenConceptId);
    });
  }

  function openConceptDetail(conceptId) {
    var listContainer = document.getElementById("concepts-list");
    var detailContainer = document.getElementById("concept-detail");
    listContainer.style.display = "none";
    detailContainer.style.display = "block";
    detailContainer.textContent = "";

    // Back button
    detailContainer.appendChild(h("button", {
      className: "btn-back",
      onclick: function() {
        detailContainer.style.display = "none";
        listContainer.style.display = "block";
      }
    }, "\u2190 Back to concepts"));

    // Skeleton
    var detailSkel = h("div", { style: "margin:1rem 0" }, [
      h("div", { style: "display:flex;gap:1rem;margin-bottom:1.5rem" }, [
        h("div", { className: "skeleton", style: "width:200px;height:28px" }),
        h("div", { className: "skeleton", style: "width:60px;height:28px" }),
        h("div", { className: "skeleton", style: "width:80px;height:28px" })
      ]),
      h("div", { className: "stats-row" }, [
        h("div", { className: "stat-card skeleton", style: "height:70px" }),
        h("div", { className: "stat-card skeleton", style: "height:70px" }),
        h("div", { className: "stat-card skeleton", style: "height:70px" }),
        h("div", { className: "stat-card skeleton", style: "height:70px" })
      ]),
      h("div", { className: "skeleton", style: "height:300px;border-radius:8px;margin-top:1rem" })
    ]);
    detailContainer.appendChild(detailSkel);

    fetch("/api/analytics/concept/" + encodeURIComponent(conceptId), { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // Clear skeleton, keep back button
        while (detailContainer.children.length > 1) detailContainer.removeChild(detailContainer.lastChild);

        // Concept header
        var c = data.concept;
        var m = data.mastery;
        var detailName = c.id.replace(/-/g, " ").replace(/\//g, " \u203A ");
        detailContainer.appendChild(h("div", { className: "concept-detail-header" }, [
          h("h2", { style: "font-family:var(--font-display)" }, detailName),
          c.domain ? h("span", { className: "domain-badge" }, c.domain) : null,
          m ? h("span", { className: "mastery-range-large" }, m.low + "\u2013" + m.high + "%") : null,
        ]));

        // Analytics stats
        if (data.analytics) {
          var a = data.analytics;
          var statsRow = h("div", { className: "stats-row" });
          statsRow.appendChild(statCard(a.totalProbes, "Probes", ""));
          statsRow.appendChild(statCard(a.totalTutorSessions, "Tutor Sessions", ""));
          statsRow.appendChild(statCard(a.currentStreak, "Current Streak", a.currentStreak > 0 ? "green" : ""));
          statsRow.appendChild(statCard(a.longestStreak, "Best Streak", "accent"));
          detailContainer.appendChild(statsRow);
        }

        // Mastery timeline chart with confidence band
        var chartPanel = h("div", { className: "chart-panel", style: "height:300px;margin:1rem 0", role: "img", "aria-label": "Mastery timeline chart showing assessment history for " + detailName });
        detailContainer.appendChild(chartPanel);

        if (data.timeline && data.timeline.length > 0 && typeof echarts !== "undefined") {
          var chartTimeline = data.timeline.filter(function(t) { return t.mastery; });
          if (chartTimeline.length === 0) { chartPanel.style.display = "none"; }
          var chart = echarts.init(chartPanel, 'warm');
          var timestamps = chartTimeline.map(function(t) { return new Date(t.timestamp).toLocaleDateString(); });
          var values = chartTimeline.map(function(t) { return t.mastery.value; });
          var lows = chartTimeline.map(function(t) { return t.mastery.low; });
          var highs = chartTimeline.map(function(t) { return t.mastery.high; });

          chart.setOption({
            tooltip: {
              trigger: "axis",
              formatter: function(params) {
                var idx = params[0].dataIndex;
                var t = chartTimeline[idx];
                if (!t || !t.mastery) return timestamps[idx];
                return timestamps[idx] + "<br/>Mastery: " + t.mastery.low + "\u2013" + t.mastery.high + "%"
                  + "<br/>Score: " + t.rubricScore + "/3"
                  + "<br/>Type: " + t.eventType;
              }
            },
            xAxis: { type: "category", data: timestamps },
            yAxis: { type: "value", min: 0, max: 100, name: "Mastery %" },
            series: [
              { type: "line", data: lows, stack: "band", areaStyle: { opacity: 0 }, lineStyle: { opacity: 0 }, symbol: "none" },
              { type: "line", data: highs.map(function(h, i) { return h - lows[i]; }), stack: "band", areaStyle: { opacity: 0.15 }, lineStyle: { opacity: 0 }, symbol: "none" },
              { type: "line", data: values, smooth: true, lineStyle: { width: 2 }, symbol: "circle", symbolSize: 6, cursor: "pointer" },
            ],
            grid: { top: 30, right: 20, bottom: 30, left: 50 },
          });

          // Click handler → open event detail panel
          var timelineEventIds = data.timeline.filter(function(t) { return t.eventId; }).map(function(t) { return t.eventId; });
          chart.on("click", function(params) {
            if (params.seriesIndex !== 2) return; // only the main mastery line
            var idx = params.dataIndex;
            var ev = data.timeline[idx];
            if (!ev || !ev.eventId) return;
            var currentIndex = timelineEventIds.indexOf(ev.eventId);
            fetchEventDetail(ev.eventId).then(function(eventData) {
              openEventPanel(eventData, {
                eventIds: timelineEventIds,
                currentIndex: currentIndex,
                fetchEvent: fetchEventDetail
              });
            });
          });

          window.addEventListener("resize", function() { chart.resize(); });
        }

        // Event log
        if (data.timeline && data.timeline.length > 0) {
          detailContainer.appendChild(h("div", { className: "section-title", style: "margin-top:1.5rem" }, "Assessment History"));
          var scrollContainer = h("div", { className: "scroll-container", style: "max-height:300px;overflow-y:auto" });
          var table = h("table", { className: "activity-table" });
          var thead = h("thead", null, [
            h("tr", null, [
              h("th", null, "Type"), h("th", null, "Score"), h("th", null, "Mastery"),
              h("th", null, "Integrity"), h("th", null, "When"),
            ])
          ]);
          table.appendChild(thead);
          var tbody = h("tbody");
          var historyEventIds = data.timeline.filter(function(t) { return t.eventId && t.type !== "dismissal"; }).map(function(t) { return t.eventId; });
          data.timeline.forEach(function(ev, _idx) {
            if (ev.type === "dismissal") {
              var dRow = h("tr", { className: "dismissal-row", style: "cursor:pointer", onclick: (function(evRef) { return function() {
                openEventPanel(evRef, { isDismissal: true });
              }; })(ev) }, [
                h("td", { style: "font-style:normal" }, reasonBadge(ev.reason)),
                h("td", null, "\u2014"),
                h("td", { style: "font-style:normal;color:var(--text-tertiary)" }, "\u2014"),
                h("td", { style: "font-style:normal;color:var(--text-tertiary)" }, "\u2014"),
                h("td", { style: "font-style:normal" }, timeAgo(ev.timestamp)),
              ]);
              tbody.appendChild(dRow);
              return;
            }
            var row = h("tr", { style: ev.eventId ? "cursor:pointer" : "", onclick: ev.eventId ? (function(evRef, i) { return function() {
              fetchEventDetail(evRef.eventId).then(function(eventData) {
                openEventPanel(eventData, {
                  eventIds: historyEventIds,
                  currentIndex: i,
                  fetchEvent: fetchEventDetail
                });
              });
            }; })(ev, historyEventIds.indexOf(ev.eventId)) : null }, [
              h("td", null, ev.eventType),
              h("td", null, ev.rubricScore + "/3"),
              h("td", null, ev.mastery.low + "\u2013" + ev.mastery.high + "%"),
              h("td", null, ev.integrityScore !== null ? (ev.integrityScore * 100).toFixed(0) + "%" : "\u2014"),
              h("td", null, timeAgo(ev.timestamp)),
            ]);
            tbody.appendChild(row);
          });
          table.appendChild(tbody);
          scrollContainer.appendChild(table);
          detailContainer.appendChild(scrollContainer);
        }

        // Tutor sessions
        if (data.tutorSessions && data.tutorSessions.length > 0) {
          detailContainer.appendChild(h("div", { className: "section-title", style: "margin-top:1.5rem" }, "Tutor Sessions"));
          var tutorScroll = h("div", { className: "scroll-container", style: "max-height:250px;overflow-y:auto" });
          data.tutorSessions.forEach(function(ts) {
            tutorScroll.appendChild(h("div", { className: "tutor-session-card" }, [
              h("div", null, "Phase " + ts.phase + "/4"),
              ts.phase1Score !== null ? h("div", null, "P1 Score: " + ts.phase1Score + "/3") : null,
              ts.phase4Score !== null ? h("div", null, "P4 Score: " + ts.phase4Score + "/3") : null,
              h("div", { className: "text-secondary" }, timeAgo(ts.startedAt)),
            ]));
          });
          detailContainer.appendChild(tutorScroll);
        }

        // Prerequisites
        if (data.prerequisites && data.prerequisites.length > 0) {
          detailContainer.appendChild(h("div", { className: "section-title", style: "margin-top:1.5rem" }, "Prerequisites"));
          data.prerequisites.forEach(function(p) {
            var prereqEl = h("div", { className: "prereq-item" }, [
              h("span", null, p.conceptId),
              p.mastery
                ? h("span", { className: "mastery-range" }, p.mastery.low + "\u2013" + p.mastery.high + "%")
                : h("span", { className: "text-tertiary" }, "Not assessed"),
            ]);
            detailContainer.appendChild(prereqEl);
          });
        }
      });
  }

  // --- Integrity Tab ---

  function renderIntegrity() {
    var trendEl = document.getElementById("integrity-trend");
    var dismissEl = document.getElementById("integrity-dismissals");
    if (!trendEl || !dismissEl) return;
    trendEl.textContent = "";
    dismissEl.textContent = "";

    // Fetch all assessed concepts, then their history for integrity data
    var assessed = Object.keys(allMasteryMap).filter(function(id) { return allMasteryMap[id].lastAssessed; });
    if (assessed.length === 0) {
      trendEl.appendChild(h("div", { className: "empty-state" }, "No assessments yet."));
      dismissEl.appendChild(h("div", { className: "empty-state" }, "No data yet."));
      return;
    }

    var topConcepts = assessed
      .sort(function(a, b) {
        return new Date(allMasteryMap[b].lastAssessed).getTime() - new Date(allMasteryMap[a].lastAssessed).getTime();
      })
      .slice(0, 10);

    Promise.all(topConcepts.map(function(conceptId) {
      return fetch("/api/mastery/" + encodeURIComponent(conceptId) + "/history", { headers: getHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(events) { return events.map(function(e) { e._conceptId = conceptId; return e; }); });
    })).then(function(results) {
      var allEvents = [].concat.apply([], results);
      allEvents.sort(function(a, b) { return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); });

      // Integrity trend chart
      var withIntegrity = allEvents.filter(function(e) { return e.integrityScore !== null && e.integrityScore !== undefined; });
      if (withIntegrity.length > 0 && typeof echarts !== "undefined") {
        var chart = echarts.init(trendEl, 'warm');
        chart.setOption({
          tooltip: {
            trigger: "axis",
            formatter: function(params) {
              var ev = withIntegrity[params[0].dataIndex];
              var name = (ev._conceptId || "").replace(/-/g, " ");
              return name + "<br/>Integrity: " + (ev.integrityScore * 100).toFixed(0) + "%"
                + "<br/>Score: " + ev.rubricScore + "/3"
                + "<br/>" + timeAgo(ev.createdAt);
            }
          },
          xAxis: { type: "category", data: withIntegrity.map(function(_e, i) { return i + 1; }), name: "Assessment #" },
          yAxis: { type: "value", min: 0, max: 1, name: "Integrity Score", axisLabel: { formatter: function(v) { return (v * 100) + "%"; } } },
          series: [{
            type: "line",
            data: withIntegrity.map(function(e) { return e.integrityScore; }),
            smooth: true,
            markLine: { data: [{ yAxis: 0.5, label: { formatter: "Threshold" }, lineStyle: { color: "#B84233", type: "dashed" } }], silent: true },
            areaStyle: { opacity: 0.1 },
            lineStyle: { width: 2 },
          }],
          grid: { top: 30, right: 20, bottom: 40, left: 60 },
        });
        window.addEventListener("resize", function() { chart.resize(); });

        // Stats above the chart
        var avg = withIntegrity.reduce(function(s, e) { return s + e.integrityScore; }, 0) / withIntegrity.length;
        var flagged = withIntegrity.filter(function(e) { return e.integrityScore < 0.5; });
        var statsRow = h("div", { className: "stats-row", style: "margin-bottom:1rem" });
        statsRow.appendChild(statCard((avg * 100).toFixed(0) + "%", "Avg Integrity", avg >= 0.8 ? "green" : avg >= 0.5 ? "amber" : ""));
        statsRow.appendChild(statCard(String(flagged.length), "Flagged", flagged.length > 0 ? "" : "green"));
        statsRow.appendChild(statCard(String(withIntegrity.length), "Total Assessed", ""));
        statsRow.appendChild(statCard((withIntegrity.length > 0 ? ((1 - flagged.length / withIntegrity.length) * 100).toFixed(0) : "0") + "%", "Clean Rate", "green"));
        trendEl.parentNode.insertBefore(statsRow, trendEl);
      } else {
        trendEl.appendChild(h("div", { className: "empty-state" }, "No integrity data recorded yet."));
      }

      // Dismiss patterns — show flagged events table
      var flaggedEvents = allEvents.filter(function(e) { return e.integrityScore !== null && e.integrityScore < 0.5; });
      if (flaggedEvents.length > 0) {
        flaggedEvents.sort(function(a, b) { return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); });
        var table = h("table", { className: "activity-table" });
        table.appendChild(h("thead", {}, h("tr", {}, [
          h("th", {}, "Concept"),
          h("th", {}, "Type"),
          h("th", {}, "Score"),
          h("th", {}, "Integrity"),
          h("th", { style: "text-align:right" }, "When")
        ])));
        var tbody = h("tbody", {});
        var flaggedSlice = flaggedEvents.slice(0, 15);
        var flaggedIds = flaggedSlice.filter(function(e) { return e.id; }).map(function(e) { return e.id; });
        flaggedSlice.forEach(function(ev) {
          var name = (ev._conceptId || ev.conceptId || "").replace(/-/g, " ");
          var row = h("tr", { style: ev.id ? "cursor:pointer" : "", onclick: ev.id ? (function(evRef) { return function() {
            fetchEventDetail(evRef.id).then(function(eventData) {
              openEventPanel(eventData, {
                eventIds: flaggedIds,
                currentIndex: flaggedIds.indexOf(evRef.id),
                fetchEvent: fetchEventDetail
              });
            });
          }; })(ev) : null }, [
            h("td", { className: "concept-name" }, name),
            h("td", { className: "event-type" }, ev.eventType === "probe" ? "Probe" : ev.eventType),
            h("td", {}, h("span", { className: "score-badge score-" + ev.rubricScore }, ev.rubricScore + "/3")),
            h("td", {}, h("span", { style: "color:" + (ev.integrityScore < 0.3 ? "var(--red)" : "var(--amber)") + ";font-weight:600" }, (ev.integrityScore * 100).toFixed(0) + "%")),
            h("td", { className: "time-ago", style: "text-align:right" }, timeAgo(ev.createdAt))
          ]);
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        dismissEl.appendChild(table);
      } else {
        dismissEl.appendChild(h("div", { className: "empty-state" }, "No flagged responses. All clear."));
      }
    });
  }

  // --- Settings Tab ---

  function renderSettings() {
    var area = document.getElementById("settings-area");
    area.textContent = "";

    // API Key Management
    var keySection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "API Keys"),
        h("div", { className: "section-subtitle" }, "Manage keys for CLI and plugin access")
      ]),
      h("div", { id: "key-reveal-area" }),
      h("div", { className: "key-list", id: "key-list" }),
      h("div", { className: "key-new", id: "key-new-btn", onclick: generateKey }, "+ Generate new API key"),
      h("div", { className: "setup-instructions" }, [
        h("h4", null, "Setup"),
        h("code", null, "claude plugin configure entendi --env ENTENDI_API_KEY=<your-key>")
      ])
    ]);
    area.appendChild(keySection);

    // Billing
    var billingSection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "Plan & Billing")
      ]),
      h("div", { id: "billing-area" })
    ]);
    area.appendChild(billingSection);

    // Email preferences
    var prefsSection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "Email Preferences")
      ]),
      h("div", { id: "prefs-area" })
    ]);
    area.appendChild(prefsSection);

    // Danger Zone
    var dangerSection = h("div", { className: "section" });
    dangerSection.style.borderColor = "var(--red)";
    var dangerHeader = h("div", { className: "section-header" }, [
      h("div", { className: "section-title" }, "Danger Zone")
    ]);
    dangerHeader.querySelector(".section-title").style.color = "var(--red)";
    var deleteBtn = h("button", { className: "btn-sm", onclick: deleteAccount }, "Delete Account");
    deleteBtn.style.color = "var(--red)";
    deleteBtn.style.borderColor = "var(--red)";
    deleteBtn.style.background = "var(--bg-card)";
    deleteBtn.style.border = "1px solid var(--red)";
    deleteBtn.style.borderRadius = "6px";
    deleteBtn.style.padding = "0.4rem 0.8rem";
    deleteBtn.style.cursor = "pointer";
    deleteBtn.style.fontSize = "0.8rem";
    var dangerDesc = h("div", { className: "auth-subtitle" }, "Permanently delete your account and all associated data. This action cannot be undone.");
    dangerSection.appendChild(dangerHeader);
    dangerSection.appendChild(dangerDesc);
    dangerSection.appendChild(deleteBtn);
    area.appendChild(dangerSection);

    loadKeys();
    loadBilling();
    loadPreferences();
  }

  function loadKeys() {
    fetch("/api/auth/api-key/list", { method: "GET", headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(keys) {
        var list = document.getElementById("key-list");
        if (!list) return;
        list.textContent = "";
        if (!keys || !Array.isArray(keys)) return;
        keys.forEach(function(key) {
          var nameEl = h("div", { className: "key-card-name" }, key.name || "API Key");
          var previewEl = h("div", { className: "key-card-preview" }, key.start ? (key.start + "...") : "entendi_...");
          var revokeBtn = h("button", { className: "btn-danger", onclick: function() { revokeKey(key.id); } }, "Revoke");
          var card = h("div", { className: "key-card" }, [
            h("div", { className: "key-card-info" }, [nameEl, previewEl]),
            h("div", { className: "key-card-actions" }, [revokeBtn])
          ]);
          list.appendChild(card);
        });
      })
      .catch(function() {});
  }

  function generateKey() {
    fetch("/api/auth/api-key/create", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name: "Dashboard key" })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.key) {
          showKeyReveal(data.key);
          loadKeys();
        }
      })
      .catch(function() {});
  }

  function showKeyReveal(fullKey) {
    var area = document.getElementById("key-reveal-area");
    if (!area) return;
    area.textContent = "";
    var valueEl = h("div", { className: "key-reveal-value" }, fullKey);
    var copyBtn = h("button", { className: "btn-copy", onclick: function() {
      navigator.clipboard.writeText(fullKey).then(function() {
        copyBtn.textContent = "Copied!";
        setTimeout(function() { copyBtn.textContent = "Copy"; }, 2000);
      });
    }}, "Copy");

    var noteEl = h("div", null, "Copy this key now. It will not be shown again.");
    noteEl.style.marginTop = "0.25rem";

    var reveal = h("div", { className: "key-reveal" }, [
      h("strong", null, "New API key created"),
      noteEl,
      valueEl,
      copyBtn
    ]);
    area.appendChild(reveal);
  }

  function revokeKey(keyId) {
    fetch("/api/auth/api-key/delete", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ keyId: keyId })
    })
      .then(function() { loadKeys(); })
      .catch(function() {});
  }

  function loadBilling() {
    var area = document.getElementById("billing-area");
    if (!area) return;
    area.textContent = "";

    fetch("/api/billing/subscription", { headers: getHeaders() })
      .then(function(r) {
        if (r.ok) return r.json();
        return null;
      })
      .then(function(sub) {
        renderBilling(sub);
      })
      .catch(function() {
        renderBilling(null);
      });
  }

  function renderBilling(sub) {
    var area = document.getElementById("billing-area");
    if (!area) return;
    area.textContent = "";

    var planName = "Free";
    var planPrice = "$0/month";

    if (sub?.plan) {
      if (sub.plan === "earned_free") { planName = "Earned Free"; planPrice = "$0/month"; }
      else if (sub.plan === "pro") { planName = "Pro"; planPrice = "$5/month"; }
      else if (sub.plan === "team_small") { planName = "Team Small"; planPrice = "$3/seat/month"; }
      else if (sub.plan === "team") { planName = "Team"; planPrice = "$2/seat/month"; }
    }

    var card = h("div", { className: "plan-card current" }, [
      h("div", { className: "plan-name" }, planName),
      h("div", { className: "plan-price" }, planPrice)
    ]);

    var features = h("ul", { className: "plan-features" });
    if (planName === "Free") {
      features.appendChild(h("li", null, "25 concepts tracked"));
      features.appendChild(h("li", null, "Basic mastery tracking"));
      features.appendChild(h("li", null, "Earn more by mastering concepts"));
    } else if (planName === "Earned Free") {
      features.appendChild(h("li", null, "50 concepts tracked"));
      features.appendChild(h("li", null, "Extended mastery tracking"));
      features.appendChild(h("li", null, "Renews if mastery stays above 80%"));
    } else if (planName === "Pro") {
      features.appendChild(h("li", null, "Unlimited concepts"));
      features.appendChild(h("li", null, "Full history & analytics"));
    }
    card.appendChild(features);
    area.appendChild(card);

    if (planName === "Free" || planName === "Earned Free") {
      var upgradeBtn = h("button", { className: "btn-sm primary", onclick: function() {
        fetch("/api/billing/checkout", { method: "POST", headers: getHeaders(), body: JSON.stringify({ plan: "pro" }) })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.url) window.location.href = data.url;
          })
          .catch(function() {});
      }}, "Upgrade to Pro");
      area.appendChild(upgradeBtn);
    }

    if (planName === "Free") {
      var progress = h("div", { className: "earned-free-progress" }, [
        h("strong", null, "Earn more free usage"),
        h("div", null, "Master 80% of your tracked concepts to unlock 50 concept slots for 2 weeks.")
      ]);
      area.appendChild(progress);
    }

    if (sub?.earnedFreeUntil && planName === "Earned Free") {
      var expiryDate = new Date(sub.earnedFreeUntil).toLocaleDateString();
      var expiryNote = h("div", { className: "earned-free-progress" }, [
        h("strong", null, "Earned free active"),
        h("div", null, "Your extended access is valid until " + expiryDate + ". Keep your mastery above 80% to auto-renew.")
      ]);
      area.appendChild(expiryNote);
    }
  }

  function loadPreferences() {
    var area = document.getElementById("prefs-area");
    if (!area) return;
    area.textContent = "";

    fetch("/api/preferences", { headers: getHeaders() })
      .then(function(r) {
        if (r.ok) return r.json();
        return { summaryFrequency: "weekly", transactionalEnabled: true };
      })
      .then(function(prefs) {
        renderPreferences(prefs);
      })
      .catch(function() {
        renderPreferences({ summaryFrequency: "weekly", transactionalEnabled: true });
      });
  }

  function renderPreferences(prefs) {
    var area = document.getElementById("prefs-area");
    if (!area) return;
    area.textContent = "";

    var freqSelect = h("select", { onchange: function() { savePreferences({ summaryFrequency: this.value }); } });
    ["weekly", "biweekly", "monthly", "off"].forEach(function(opt) {
      var option = h("option", { value: opt }, opt.charAt(0).toUpperCase() + opt.slice(1));
      if (prefs.summaryFrequency === opt) option.selected = true;
      freqSelect.appendChild(option);
    });

    var freqRow = h("div", { className: "pref-row" }, [
      h("div", null, [
        h("div", { className: "pref-label" }, "Mastery summary emails"),
        h("div", { className: "pref-desc" }, "Periodic reports on your learning progress")
      ]),
      freqSelect
    ]);
    area.appendChild(freqRow);

    var isOn = prefs.transactionalEnabled !== false;
    var toggleBtn = h("button", { className: "toggle" + (isOn ? " on" : ""), onclick: function() {
      var nowOn = this.classList.contains("on");
      if (nowOn) this.classList.remove("on"); else this.classList.add("on");
      savePreferences({ transactionalEnabled: !nowOn });
    }});

    var transRow = h("div", { className: "pref-row" }, [
      h("div", null, [
        h("div", { className: "pref-label" }, "Transactional emails"),
        h("div", { className: "pref-desc" }, "API key creation, device linking, invite notifications")
      ]),
      toggleBtn
    ]);
    area.appendChild(transRow);
  }

  function savePreferences(partial) {
    fetch("/api/preferences", {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify(partial)
    }).catch(function() {});
  }

  // --- Organization Tab ---

  function renderOrganization() {
    var area = document.getElementById("org-area");
    area.textContent = "";

    fetch("/api/auth/organization/list", { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(orgs) {
        if (!orgs || !Array.isArray(orgs) || orgs.length === 0) {
          renderNoOrg(area);
        } else {
          renderOrgDashboard(area, orgs[0]);
        }
      })
      .catch(function() {
        renderNoOrg(area);
      });
  }

  function renderNoOrg(area) {
    area.textContent = "";
    var section = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "Create Organization")
      ]),
      h("div", { className: "auth-subtitle" }, "Organizations let teams share concepts and track mastery together."),
      h("div", { className: "org-form", id: "create-org-form" }, [
        h("input", { type: "text", id: "org-name", placeholder: "Organization name" }),
        h("input", { type: "text", id: "org-slug", placeholder: "org-slug" }),
        h("button", { className: "btn-sm primary", onclick: createOrg }, "Create")
      ]),
      h("div", { className: "error-text", id: "org-error" })
    ]);
    area.appendChild(section);
  }

  function createOrg() {
    var name = document.getElementById("org-name").value.trim();
    var slug = document.getElementById("org-slug").value.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!name) return;

    fetch("/api/auth/organization/create", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name: name, slug: slug })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.id || data.organization) {
          renderOrganization();
        } else {
          var err = document.getElementById("org-error");
          if (err) err.textContent = data.message || "Failed to create organization";
        }
      })
      .catch(function() {
        var err = document.getElementById("org-error");
        if (err) err.textContent = "Network error";
      });
  }

  function renderOrgDashboard(area, org) {
    area.textContent = "";

    // Three-dot menu
    var dotMenuDropdown = h("div", { className: "dot-menu-dropdown" });
    var renameItem = h("button", { className: "dot-menu-item", onclick: function() {
      dotMenuDropdown.classList.remove("open");
      var newName = prompt("Rename organization:", org.name || "");
      if (newName?.trim() && newName.trim() !== org.name) {
        fetch("/api/auth/organization/update", {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ data: { name: newName.trim() }, organizationId: org.id })
        })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.error || data.message) {
              var err = document.getElementById("org-action-error");
              if (err) err.textContent = data.error || data.message;
            } else {
              renderOrganization();
            }
          });
      }
    }}, "Rename");
    var deleteItem = h("button", { className: "dot-menu-item danger", onclick: function() {
      dotMenuDropdown.classList.remove("open");
      deleteOrg(org.id);
    }}, "Delete Organization");
    dotMenuDropdown.appendChild(renameItem);
    dotMenuDropdown.appendChild(deleteItem);

    var dotMenuTrigger = h("button", { className: "dot-menu-trigger", onclick: function(e) {
      e.stopPropagation();
      dotMenuDropdown.classList.toggle("open");
    }}, "\u22EF");
    var dotMenu = h("div", { className: "dot-menu" }, [dotMenuTrigger, dotMenuDropdown]);

    // Close dropdown on outside click
    document.addEventListener("click", function() { dotMenuDropdown.classList.remove("open"); });

    var orgHeader = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, org.name || org.slug || "Organization"),
        dotMenu
      ]),
      h("div", { className: "error-text", id: "org-action-error" })
    ]);
    area.appendChild(orgHeader);

    var inviteSection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "Invite Member")
      ]),
      h("div", { className: "org-form" }, [
        h("input", { type: "email", id: "invite-email", placeholder: "colleague@example.com" }),
        h("select", { id: "invite-role" }, [
          h("option", { value: "member" }, "Member"),
          h("option", { value: "admin" }, "Admin")
        ]),
        h("button", { className: "btn-sm primary", onclick: function() { inviteMember(org.id); } }, "Invite")
      ]),
      h("div", { className: "error-text", id: "invite-error" }),
      h("div", { id: "invite-success" })
    ]);
    area.appendChild(inviteSection);

    var pendingSection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "Pending Invitations")
      ]),
      h("div", { id: "pending-list" })
    ]);
    area.appendChild(pendingSection);

    var membersSection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "Members")
      ]),
      h("div", { id: "members-list" })
    ]);
    area.appendChild(membersSection);

    var rankingsSection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "Mastery Rankings")
      ]),
      h("div", { id: "rankings-area" })
    ]);
    area.appendChild(rankingsSection);

    var integritySection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "Response Integrity"),
        h("div", { className: "section-subtitle" }, "Monitor response authenticity across your organization")
      ]),
      h("div", { className: "stats-row", id: "integrity-stats" }),
      h("div", { id: "integrity-flagged-area" })
    ]);
    area.appendChild(integritySection);

    var dismissalsSection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, [
        h("div", { className: "section-title" }, "Dismissals"),
        h("div", { className: "section-subtitle" }, "Track probe dismissal patterns across your organization")
      ]),
      h("div", { className: "stats-row", id: "dismissal-stats" }),
      h("div", { id: "dismissals-filters-area" }),
      h("div", { id: "dismissals-table-area" })
    ]);
    area.appendChild(dismissalsSection);

    loadPendingInvites(org.id);
    loadMembers(org.id);
    loadRankings(org.id);
    loadIntegrityStats();
    loadDismissalStats();
    loadOrgDismissals(1, null);
  }

  function inviteMember(orgId) {
    var email = document.getElementById("invite-email").value.trim();
    var role = document.getElementById("invite-role").value;
    if (!email) return;

    fetch("/api/auth/organization/invite-member", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ email: email, role: role, organizationId: orgId })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var errEl = document.getElementById("invite-error");
        var successEl = document.getElementById("invite-success");
        if (data.error || data.message) {
          if (errEl) errEl.textContent = data.error || data.message;
          if (successEl) successEl.textContent = "";
        } else {
          if (successEl) {
            successEl.textContent = "Invitation sent to " + email;
            successEl.style.fontSize = "0.8rem";
            successEl.style.color = "var(--green)";
          }
          if (errEl) errEl.textContent = "";
          document.getElementById("invite-email").value = "";
          loadPendingInvites(orgId);
        }
      })
      .catch(function() {
        var errEl = document.getElementById("invite-error");
        if (errEl) errEl.textContent = "Failed to send invitation";
      });
  }

  function loadPendingInvites(orgId) {
    fetch("/api/auth/organization/list-invitations?organizationId=" + orgId, { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(invites) {
        var list = document.getElementById("pending-list");
        if (!list) return;
        list.textContent = "";

        var pending = (invites || []).filter(function(inv) { return inv.status === "pending"; });
        if (pending.length === 0) {
          list.appendChild(h("div", { className: "empty-state" }, "No pending invitations."));
          return;
        }

        var inviteList = h("div", { className: "member-list" });
        pending.forEach(function(inv) {
          var revokeBtn = h("button", {
            className: "btn-sm",
            onclick: function() { cancelInvite(inv.id, orgId); }
          }, "Revoke");
          revokeBtn.style.fontSize = "0.7rem";
          revokeBtn.style.padding = "0.2rem 0.5rem";
          revokeBtn.style.color = "var(--red)";
          revokeBtn.style.border = "1px solid var(--border)";
          revokeBtn.style.background = "var(--bg-card)";
          revokeBtn.style.borderRadius = "4px";
          revokeBtn.style.cursor = "pointer";

          var row = h("div", { className: "member-row" }, [
            h("div", null, [
              h("div", { className: "member-name" }, inv.email),
              h("div", { className: "member-email" }, "Invited " + new Date(inv.createdAt).toLocaleDateString())
            ]),
            h("div", { className: "member-role" }, inv.role),
            revokeBtn
          ]);
          inviteList.appendChild(row);
        });
        list.appendChild(inviteList);
      })
      .catch(function() {
        var list = document.getElementById("pending-list");
        if (list) list.appendChild(h("div", { className: "empty-state" }, "Failed to load invitations."));
      });
  }

  function cancelInvite(invitationId, orgId) {
    fetch("/api/auth/organization/cancel-invitation", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ invitationId: invitationId })
    })
      .then(function(r) { return r.json(); })
      .then(function() {
        loadPendingInvites(orgId);
      })
      .catch(function() {});
  }

  function deleteOrg(orgId) {
    if (!confirm("Delete this organization? This cannot be undone.")) return;
    fetch("/api/auth/organization/delete", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ organizationId: orgId })
    })
      .then(function(r) { return r.json(); })
      .then(function() {
        renderOrganization();
      })
      .catch(function() {});
  }

  function removeMember(memberId, orgId) {
    if (!confirm("Remove this member from the organization?")) return;
    fetch("/api/auth/organization/remove-member", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ memberIdOrEmail: memberId, organizationId: orgId })
    })
      .then(function(r) { return r.json(); })
      .then(function() {
        loadMembers(orgId);
      })
      .catch(function() {});
  }

  function updateMemberRole(memberId, newRole, orgId) {
    fetch("/api/auth/organization/update-member-role", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ memberId: memberId, role: newRole, organizationId: orgId })
    })
      .then(function(r) { return r.json(); })
      .then(function() {
        loadMembers(orgId);
      })
      .catch(function() {});
  }

  function deleteAccount() {
    if (!confirm("Delete your account? All your data will be permanently removed. This cannot be undone.")) return;
    if (!confirm("Are you really sure? This is irreversible.")) return;
    fetch("/api/auth/delete-user", {
      method: "POST",
      headers: getHeaders(),
      body: "{}"
    })
      .then(function() {
        localStorage.removeItem("entendi_token");
        token = null;
        location.reload();
      })
      .catch(function() {
        alert("Failed to delete account.");
      });
  }

  function loadMembers(orgId) {
    fetch("/api/org/members", { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(members) {
        var list = document.getElementById("members-list");
        if (!list) return;
        list.textContent = "";

        if (!members || !Array.isArray(members) || members.length === 0) {
          list.appendChild(h("div", { className: "empty-state" }, "No members yet."));
          return;
        }

        var memberList = h("div", { className: "member-list" });
        members.forEach(function(m) {
          var avgPct = m.mastery && m.mastery.avgMastery > 0
            ? Math.round(m.mastery.avgMastery * 100) + "%"
            : "\u2014";
          var masteryInfo = m.mastery
            ? m.mastery.mastered + "/" + m.mastery.totalAssessed + " mastered"
            : "";

          var emailSpan = h("div", { className: "member-email" }, m.email);
          var infoSpan = h("div", null, "");
          infoSpan.style.fontSize = "0.7rem";
          infoSpan.style.color = "var(--text-tertiary)";
          infoSpan.textContent = masteryInfo;

          var actions = h("div");
          if (m.role !== "owner") {
            var dropdown = h("div", { className: "dot-menu-dropdown" });
            dropdown.appendChild(h("button", {
              className: "dot-menu-item",
              onclick: function() { dropdown.classList.remove("open"); updateMemberRole(m.userId, m.role === "admin" ? "member" : "admin", orgId); }
            }, m.role === "admin" ? "Demote" : "Promote"));
            dropdown.appendChild(h("button", {
              className: "dot-menu-item danger",
              onclick: function() { dropdown.classList.remove("open"); removeMember(m.userId, orgId); }
            }, "Remove"));
            var trigger = h("button", { className: "dot-menu-trigger", onclick: function(e) {
              e.stopPropagation();
              dropdown.classList.toggle("open");
            }}, "\u22EF");
            var menu = h("div", { className: "dot-menu" }, [trigger, dropdown]);
            document.addEventListener("click", function() { dropdown.classList.remove("open"); });
            actions.appendChild(menu);
          }

          var row = h("div", { className: "member-row", onclick: (function(memberInfo) { return function() { openMemberDetail(memberInfo); }; })(m) }, [
            h("div", null, [
              h("div", { className: "member-name" }, m.name || m.email),
              emailSpan
            ]),
            h("div", { className: "member-role" }, m.role),
            h("div", { className: "member-mastery" }, avgPct),
            actions
          ]);
          memberList.appendChild(row);
        });
        list.appendChild(memberList);
      })
      .catch(function() {});
  }

  function openMemberDetail(memberInfo) {
    var area = document.getElementById("org-area");
    area.textContent = "";

    // Back button
    area.appendChild(h("button", {
      className: "btn-back",
      onclick: function() { renderOrganization(); }
    }, "\u2190 Back to organization"));

    // Header: name, email, role badge, avg mastery
    var avgPct = memberInfo.mastery && memberInfo.mastery.avgMastery > 0
      ? Math.round(memberInfo.mastery.avgMastery * 100) + "%" : "\u2014";
    area.appendChild(h("div", { className: "concept-detail-header" }, [
      h("h2", { style: "font-family:var(--font-display)" }, memberInfo.name || memberInfo.email),
      h("span", { className: "member-role" }, memberInfo.role),
      h("span", { className: "mastery-range-large" }, avgPct)
    ]));

    // Three sections with loading skeletons
    var conceptsSection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, h("div", { className: "section-title" }, "Concepts")),
      h("div", { id: "member-concepts-area" })
    ]);
    var historySection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, h("div", { className: "section-title" }, "Recent Activity")),
      h("div", { id: "member-history-area" })
    ]);
    var integritySection = h("div", { className: "section" }, [
      h("div", { className: "section-header" }, h("div", { className: "section-title" }, "Integrity")),
      h("div", { id: "member-integrity-area" })
    ]);
    area.appendChild(conceptsSection);
    area.appendChild(historySection);
    area.appendChild(integritySection);

    // Fetch all three in parallel
    loadMemberConcepts(memberInfo.userId);
    loadMemberHistory(memberInfo.userId);
    loadMemberIntegrity(memberInfo.userId);
  }

  function loadMemberConcepts(userId) {
    var area = document.getElementById("member-concepts-area");
    if (!area) return;
    area.textContent = "";
    area.appendChild(h("div", { className: "skeleton", style: "height:120px" }, ""));

    fetch("/api/org/members/" + encodeURIComponent(userId), { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        area.textContent = "";
        var concepts = data.concepts || [];
        if (concepts.length === 0) {
          area.appendChild(h("div", { className: "empty-state" }, "No concepts assessed yet."));
          return;
        }

        concepts.sort(function(a, b) {
          return (b.lastAssessed || "").localeCompare(a.lastAssessed || "");
        });

        var table = h("table", { className: "activity-table" });
        table.appendChild(h("thead", {}, h("tr", {}, [
          h("th", {}, "Concept"),
          h("th", {}, "Mastery"),
          h("th", { style: "text-align:center" }, "Confidence"),
          h("th", { style: "text-align:center" }, "Assessments"),
          h("th", { style: "text-align:right" }, "Last Assessed")
        ])));

        var tbody = h("tbody", {});
        concepts.forEach(function(c) {
          var p = Math.round(c.mastery * 100);
          var displayName = c.conceptId.replace(/-/g, " ").replace(/\//g, " \u203A ");
          var conf = confidenceLabel(c.sigma, c.assessmentCount);

          var masteryCell = h("td", {});
          var barContainer = h("div", { className: "mastery-bar-container", style: "display:inline-block;width:80px;vertical-align:middle" });
          var bar = h("div", { className: "mastery-bar" });
          bar.style.width = p + "%";
          bar.style.background = masteryColor(p);
          barContainer.appendChild(bar);
          masteryCell.appendChild(barContainer);
          var low = Math.round(pMastery(c.mu - 2 * c.sigma) * 100);
          var high = Math.min(100, Math.round(pMastery(c.mu + 2 * c.sigma) * 100));
          masteryCell.appendChild(h("span", { className: "mastery-range" }, low + "\u2013" + high + "%"));

          tbody.appendChild(h("tr", {}, [
            h("td", {}, h("span", { className: "concept-name" }, displayName)),
            masteryCell,
            h("td", { style: "text-align:center" }, h("span", { className: "confidence-badge " + conf.cls }, conf.text)),
            h("td", { style: "text-align:center" }, String(c.assessmentCount)),
            h("td", { className: "time-ago", style: "text-align:right" }, timeAgo(c.lastAssessed))
          ]));
        });
        table.appendChild(tbody);
        area.appendChild(table);
      })
      .catch(function() {
        area.textContent = "";
        area.appendChild(h("div", { className: "empty-state" }, "Failed to load concepts."));
      });
  }

  function loadMemberHistory(userId) {
    var area = document.getElementById("member-history-area");
    if (!area) return;
    area.textContent = "";
    area.appendChild(h("div", { className: "skeleton", style: "height:120px" }, ""));

    fetch("/api/org/members/" + encodeURIComponent(userId) + "/history", { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(events) {
        area.textContent = "";
        if (!events || !Array.isArray(events) || events.length === 0) {
          area.appendChild(h("div", { className: "empty-state" }, "No assessment history yet."));
          return;
        }

        var table = h("table", { className: "activity-table" });
        table.appendChild(h("thead", {}, h("tr", {}, [
          h("th", {}, "Concept"),
          h("th", {}, "Type"),
          h("th", {}, "Score"),
          h("th", {}, "Mastery"),
          h("th", { style: "text-align:right" }, "When")
        ])));

        var tbody = h("tbody", {});
        var memberEventIds = events.filter(function(e) { return e.id && e.type === "assessment"; }).map(function(e) { return e.id; });
        events.forEach(function(ev) {
          var displayName = ev.conceptId.replace(/-/g, " ").replace(/\//g, " \u203A ");

          if (ev.type === "dismissal") {
            var row = h("tr", { className: "dismissal-row", style: "cursor:pointer", onclick: (function(evRef) { return function() {
              openEventPanel(evRef, { isAdmin: true, isDismissal: true });
            }; })(ev) }, [
              h("td", {}, h("span", { className: "concept-name", style: "font-style:normal" }, displayName)),
              h("td", {}, reasonBadge(ev.reason)),
              h("td", {}, "\u2014"),
              h("td", { style: "font-style:normal;color:var(--text-tertiary)" }, ev.note || "\u2014"),
              h("td", { className: "time-ago", style: "text-align:right;font-style:normal" }, timeAgo(ev.createdAt))
            ]);
            tbody.appendChild(row);
            return;
          }

          var pBefore = Math.round(pMastery(ev.muBefore) * 100);
          var pAfter = Math.round(pMastery(ev.muAfter) * 100);
          var delta = pAfter - pBefore;
          var deltaStr = (delta >= 0 ? "+" : "") + delta + "%";
          var trendCls = delta > 0 ? "trend-up" : delta < 0 ? "trend-down" : "trend-flat";

          var typeLabel = ev.eventType === "probe" ? "Probe"
            : ev.eventType === "tutor_phase1" ? "Tutor P1"
            : ev.eventType === "tutor_phase4" ? "Tutor P4"
            : ev.eventType;

          var deltaSpan = h("span", { className: trendCls, style: "font-weight:600;margin-left:6px" }, deltaStr);
          var masteryCell = h("td", {});
          var masteryText = h("span", { style: "color:var(--text-secondary)" }, pBefore + "% \u2192 " + pAfter + "%");
          masteryText.appendChild(deltaSpan);
          masteryCell.appendChild(masteryText);

          var row = h("tr", { style: ev.id ? "cursor:pointer" : "", onclick: ev.id ? (function(evRef) { return function() {
            fetchOrgEventDetail(evRef.id).then(function(eventData) {
              openEventPanel(eventData, {
                eventIds: memberEventIds,
                currentIndex: memberEventIds.indexOf(evRef.id),
                fetchEvent: fetchOrgEventDetail,
                isAdmin: true
              });
            });
          }; })(ev) : null }, [
            h("td", {}, h("span", { className: "concept-name" }, displayName)),
            h("td", { className: "event-type" }, typeLabel),
            h("td", {}, h("span", { className: "score-badge score-" + ev.rubricScore }, ev.rubricScore + "/3")),
            masteryCell,
            h("td", { className: "time-ago", style: "text-align:right" }, timeAgo(ev.createdAt))
          ]);
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        area.appendChild(table);
      })
      .catch(function() {
        area.textContent = "";
        area.appendChild(h("div", { className: "empty-state" }, "Failed to load history."));
      });
  }

  function loadMemberIntegrity(userId) {
    var area = document.getElementById("member-integrity-area");
    if (!area) return;
    area.textContent = "";
    area.appendChild(h("div", { className: "skeleton", style: "height:120px" }, ""));

    fetch("/api/org/members/" + encodeURIComponent(userId) + "/integrity", { headers: getHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        area.textContent = "";

        // Stats row
        var statsRow = h("div", { className: "stats-row", style: "grid-template-columns:repeat(3,1fr)" });
        statsRow.appendChild(statCard(
          data.avgIntegrityScore !== null ? (data.avgIntegrityScore * 100).toFixed(0) + "%" : "\u2014",
          "Avg Integrity", data.avgIntegrityScore !== null && data.avgIntegrityScore >= 0.7 ? "green" : "amber"
        ));
        statsRow.appendChild(statCard(String(data.flaggedCount), "Flagged", data.flaggedCount > 0 ? "accent" : "green"));
        statsRow.appendChild(statCard(String(data.totalAssessed), "Total Assessed", ""));
        area.appendChild(statsRow);

        // Flagged responses table
        var flagged = data.flaggedEvents || [];
        if (flagged.length > 0) {
          area.appendChild(h("div", { className: "section-title", style: "margin-top:1rem;margin-bottom:0.5rem" }, "Flagged Responses"));
          var table = h("table", { className: "activity-table" });
          table.appendChild(h("thead", {}, h("tr", {}, [
            h("th", {}, "Concept"),
            h("th", {}, "Type"),
            h("th", {}, "Score"),
            h("th", {}, "Integrity"),
            h("th", { style: "text-align:right" }, "When")
          ])));

          var tbody = h("tbody", {});
          var memberFlaggedIds = flagged.filter(function(e) { return e.id; }).map(function(e) { return e.id; });
          flagged.forEach(function(ev) {
            var displayName = ev.conceptId.replace(/-/g, " ").replace(/\//g, " \u203A ");
            var intPct = ev.integrityScore !== null ? (ev.integrityScore * 100).toFixed(0) + "%" : "\u2014";
            var row = h("tr", { style: ev.id ? "cursor:pointer" : "", onclick: ev.id ? (function(evRef) { return function() {
              fetchOrgEventDetail(evRef.id).then(function(eventData) {
                openEventPanel(eventData, {
                  eventIds: memberFlaggedIds,
                  currentIndex: memberFlaggedIds.indexOf(evRef.id),
                  fetchEvent: fetchOrgEventDetail,
                  isAdmin: true
                });
              });
            }; })(ev) : null }, [
              h("td", {}, h("span", { className: "concept-name" }, displayName)),
              h("td", { className: "event-type" }, ev.eventType),
              h("td", {}, h("span", { className: "score-badge score-" + ev.rubricScore }, ev.rubricScore + "/3")),
              h("td", {}, h("span", { style: "color:var(--red);font-weight:600" }, intPct)),
              h("td", { className: "time-ago", style: "text-align:right" }, timeAgo(ev.createdAt))
            ]);
            tbody.appendChild(row);
          });
          table.appendChild(tbody);
          area.appendChild(table);
        }
      })
      .catch(function() {
        area.textContent = "";
        area.appendChild(h("div", { className: "empty-state" }, "Failed to load integrity data."));
      });
  }

  function loadRankings(_orgId) {
    fetch("/api/org/rankings", { headers: getHeaders() })
      .then(function(r) {
        if (r.ok) return r.json();
        return [];
      })
      .then(function(rankings) {
        var area = document.getElementById("rankings-area");
        if (!area) return;
        area.textContent = "";

        if (!rankings || !Array.isArray(rankings) || rankings.length === 0) {
          area.appendChild(h("div", { className: "empty-state" }, "No ranking data yet."));
          return;
        }

        var table = h("table", { className: "ranking-table" });
        var thead = h("thead", null, [
          h("tr", null, [
            h("th", null, "#"),
            h("th", null, "Member"),
            h("th", null, "Mastered"),
            h("th", null, "Avg Mastery"),
            h("th", null, "Assessed")
          ])
        ]);
        table.appendChild(thead);

        var tbody = h("tbody");
        rankings.forEach(function(r, i) {
          var row = h("tr", null, [
            h("td", null, String(i + 1)),
            h("td", null, r.name || r.email || "Member"),
            h("td", null, String(r.mastered || 0)),
            h("td", null, r.avgMastery ? Math.round(r.avgMastery * 100) + "%" : "\u2014"),
            h("td", null, String(r.totalAssessed || 0))
          ]);
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        area.appendChild(table);
      })
      .catch(function() {});
  }

  function loadIntegrityStats() {
    fetch("/api/org/integrity", { headers: getHeaders() })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) return;
        var container = document.getElementById("integrity-stats");
        if (!container) return;
        container.textContent = "";

        container.appendChild(statCard(
          data.avgScore !== null ? (data.avgScore * 100).toFixed(0) + "%" : "\u2014",
          "Avg Integrity"
        ));
        container.appendChild(statCard(String(data.flaggedCount || 0), "Flagged Responses"));
        container.appendChild(statCard(String(data.flaggedMemberCount || 0), "Flagged Members"));
        container.appendChild(statCard(String(data.totalWithIntegrity || 0), "Total Assessed"));
      });
    loadFlaggedResponses(1);
  }

  function loadFlaggedResponses(page) {
    fetch("/api/org/integrity/flagged?page=" + page + "&limit=10", { headers: getHeaders() })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        var area = document.getElementById("integrity-flagged-area");
        if (!area) return;
        area.textContent = "";
        if (!data || !data.items || data.items.length === 0) {
          area.appendChild(h("div", { className: "empty-state" }, "No flagged responses yet."));
          return;
        }

        var table = h("table", { className: "ranking-table" });
        table.appendChild(h("thead", null, [
          h("tr", null, [
            h("th", null, "Member"),
            h("th", null, "Concept"),
            h("th", null, "Integrity"),
            h("th", null, "Type"),
            h("th", null, "When")
          ])
        ]));

        var tbody = h("tbody");
        data.items.forEach(function(item) {
          var scoreText = (item.integrityScore * 100).toFixed(0) + "%";
          var scoreStyle = item.integrityScore < 0.3 ? "color:var(--danger)" : "color:#b45309";
          var scoreCell = h("td");
          scoreCell.style.cssText = scoreStyle + ";font-weight:600";
          scoreCell.textContent = scoreText;

          var conceptCell = h("td");
          conceptCell.textContent = item.conceptId;
          conceptCell.style.fontFamily = "var(--mono)";
          conceptCell.style.fontSize = "0.85rem";

          tbody.appendChild(h("tr", null, [
            h("td", null, item.userName || item.userEmail || "Unknown"),
            conceptCell,
            scoreCell,
            h("td", null, item.eventType),
            h("td", null, timeAgo(item.createdAt))
          ]));
        });
        table.appendChild(tbody);
        area.appendChild(table);

        // Pagination
        if (data.total > 10) {
          var totalPages = Math.ceil(data.total / 10);
          var paginationRow = h("div", { style: "display:flex;gap:0.5rem;justify-content:center;margin-top:0.75rem" });
          for (var p = 1; p <= Math.min(totalPages, 5); p++) {
            (function(pageNum) {
              var btn = h("button", {
                className: "filter-btn" + (pageNum === page ? " active" : ""),
                onclick: function() { loadFlaggedResponses(pageNum); }
              }, String(pageNum));
              paginationRow.appendChild(btn);
            })(p);
          }
          area.appendChild(paginationRow);
        }
      });
  }

  // --- Dismissal Helpers ---

  function reasonBadge(reason) {
    var labels = { topic_change: "topic change", busy: "busy", claimed_expertise: "claimed expertise" };
    return h("span", { className: "reason-badge reason-" + reason }, labels[reason] || reason);
  }

  function resolutionLabel(resolvedAs, resolvedAt) {
    if (!resolvedAs) return null;
    var labels = { answered: "Answered", expired: "Expired", auto_scored_0: "Auto-scored 0" };
    var text = labels[resolvedAs] || resolvedAs;
    if (resolvedAt) text += " " + timeAgo(resolvedAt);
    return text;
  }

  function loadDismissalStats() {
    var container = document.getElementById("dismissal-stats");
    if (!container) return;
    container.textContent = "";

    fetch("/api/org/dismissals/stats", { headers: getHeaders() })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) return;
        container.textContent = "";
        container.appendChild(statCard(String(data.totalDismissals), "Total Dismissals", ""));
        container.appendChild(statCard(String(data.byReason.topic_change || 0), "Topic Change", ""));
        container.appendChild(statCard(String(data.byReason.busy || 0), "Busy", "amber"));
        container.appendChild(statCard(String(data.byReason.claimed_expertise || 0), "Claimed Expertise", "accent"));
      });
  }

  function loadOrgDismissals(page, reasonFilter) {
    var area = document.getElementById("dismissals-table-area");
    var filtersArea = document.getElementById("dismissals-filters-area");
    if (!area) return;

    // Render filters (once)
    if (filtersArea && filtersArea.children.length === 0) {
      var filterRow = h("div", { className: "dismissal-filters" });
      var reasonSelect = h("select", { onchange: function() { loadOrgDismissals(1, reasonSelect.value || null); } }, [
        h("option", { value: "" }, "All reasons"),
        h("option", { value: "topic_change" }, "Topic change"),
        h("option", { value: "busy" }, "Busy"),
        h("option", { value: "claimed_expertise" }, "Claimed expertise")
      ]);
      filterRow.appendChild(reasonSelect);
      filtersArea.appendChild(filterRow);
    }

    area.textContent = "";
    area.appendChild(h("div", { className: "skeleton", style: "height:120px" }, ""));

    var url = "/api/org/dismissals?page=" + page + "&limit=15";
    if (reasonFilter) url += "&reason=" + encodeURIComponent(reasonFilter);

    fetch(url, { headers: getHeaders() })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        area.textContent = "";
        if (!data || !data.items || data.items.length === 0) {
          area.appendChild(h("div", { className: "empty-state" }, "No dismissals recorded yet."));
          return;
        }

        var table = h("table", { className: "activity-table" });
        table.appendChild(h("thead", {}, h("tr", {}, [
          h("th", {}, "Member"),
          h("th", {}, "Concept"),
          h("th", {}, "Reason"),
          h("th", {}, "Note"),
          h("th", {}, "Status"),
          h("th", { style: "text-align:right" }, "When")
        ])));

        var tbody = h("tbody", {});
        data.items.forEach(function(item) {
          var statusText = "\u2014";
          if (item.requeued && !item.resolvedAs) statusText = "Re-queued";
          else if (item.resolvedAs) statusText = resolutionLabel(item.resolvedAs, item.resolvedAt);

          var conceptDisplay = item.conceptId.replace(/-/g, " ").replace(/\//g, " \u203A ");

          var row = h("tr", { className: "dismissal-row" }, [
            h("td", {}, item.userName || "Unknown"),
            h("td", {}, h("span", { className: "concept-name", style: "font-style:normal" }, conceptDisplay)),
            h("td", {}, reasonBadge(item.reason)),
            h("td", { style: "max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", title: item.note || "" }, item.note || "\u2014"),
            h("td", { style: "font-style:normal" }, statusText),
            h("td", { className: "time-ago", style: "text-align:right;font-style:normal" }, timeAgo(item.createdAt))
          ]);
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        area.appendChild(table);

        // Pagination
        if (data.total > 15) {
          var totalPages = Math.ceil(data.total / 15);
          var paginationRow = h("div", { style: "display:flex;gap:0.5rem;justify-content:center;margin-top:0.75rem" });
          for (var p = 1; p <= Math.min(totalPages, 5); p++) {
            (function(pageNum) {
              var btn = h("button", {
                className: "filter-btn" + (pageNum === page ? " active" : ""),
                onclick: function() { loadOrgDismissals(pageNum, reasonFilter); }
              }, String(pageNum));
              paginationRow.appendChild(btn);
            })(p);
          }
          area.appendChild(paginationRow);
        }
      })
      .catch(function() {
        area.textContent = "";
        area.appendChild(h("div", { className: "empty-state" }, "Failed to load dismissals."));
      });
  }

  // --- Event Detail Slide-over Panel ---

  var activeEventPanel = null;

  function closeEventPanel() {
    if (!activeEventPanel) return;
    var backdrop = activeEventPanel.backdrop;
    var panel = activeEventPanel.panel;
    panel.classList.remove("open");
    backdrop.classList.remove("open");
    document.removeEventListener("keydown", activeEventPanel.escHandler);
    setTimeout(function() { backdrop.remove(); }, 250);
    activeEventPanel = null;
  }

  /**
   * Opens the event detail slide-over panel.
   * @param {Object} eventData - Full event detail object (see design doc shape)
   * @param {Object} options
   * @param {string[]} [options.eventIds] - List of event IDs for prev/next navigation
   * @param {number} [options.currentIndex] - Current index in eventIds
   * @param {function} [options.fetchEvent] - fn(eventId) → Promise<eventData>
   * @param {boolean} [options.isAdmin] - Show annotations section
   */
  function openEventPanel(eventData, options) {
    options = options || {};
    closeEventPanel();

    var backdrop = h("div", { className: "event-panel-backdrop" });
    var panel = h("div", { className: "event-panel" });

    // ESC handler
    function escHandler(e) { if (e.key === "Escape") closeEventPanel(); }
    document.addEventListener("keydown", escHandler);

    // Backdrop click
    backdrop.addEventListener("click", function(e) {
      if (e.target === backdrop) closeEventPanel();
    });

    // Track state
    activeEventPanel = { backdrop: backdrop, panel: panel, escHandler: escHandler };

    // --- Header: close + nav ---
    var eventIds = options.eventIds || [];
    var currentIdx = typeof options.currentIndex === "number" ? options.currentIndex : -1;

    var prevBtn = h("button", {
      className: "event-panel-nav-btn",
      title: "Previous event",
      onclick: function() { navigatePanel(-1); }
    }, "\u2039");
    var nextBtn = h("button", {
      className: "event-panel-nav-btn",
      title: "Next event",
      onclick: function() { navigatePanel(1); }
    }, "\u203A");

    function updateNavButtons() {
      prevBtn.disabled = currentIdx <= 0;
      nextBtn.disabled = currentIdx < 0 || currentIdx >= eventIds.length - 1;
    }
    updateNavButtons();

    function navigatePanel(dir) {
      var newIdx = currentIdx + dir;
      if (newIdx < 0 || newIdx >= eventIds.length) return;
      if (!options.fetchEvent) return;
      currentIdx = newIdx;
      updateNavButtons();
      options.fetchEvent(eventIds[newIdx]).then(function(newData) {
        options.currentIndex = newIdx;
        renderPanelContent(newData);
      });
    }

    var closeBtn = h("button", { className: "event-panel-close", title: "Close", onclick: closeEventPanel }, "\u00D7");

    var navGroup = h("div", { className: "event-panel-nav" }, [prevBtn, nextBtn]);
    var header = h("div", { className: "event-panel-header" }, [navGroup, closeBtn]);

    var body = h("div", { className: "event-panel-body" });
    panel.appendChild(header);
    panel.appendChild(body);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    // Trigger animation
    requestAnimationFrame(function() {
      backdrop.classList.add("open");
      panel.classList.add("open");
    });

    renderPanelContent(eventData);

    function renderPanelContent(data) {
      body.textContent = "";

      // Dismissal-specific panel content
      if (options.isDismissal || data.type === "dismissal" || data.reason) {
        var dConceptName = (data.conceptName || data.conceptId || "").replace(/-/g, " ").replace(/\//g, " \u203A ");
        var dConceptLink = h("span", {
          className: "event-panel-concept-name",
          onclick: function() { closeEventPanel(); if (data.conceptId) navigateToConcept(data.conceptId); }
        }, dConceptName);
        body.appendChild(h("div", { className: "event-panel-concept" }, [dConceptLink]));

        var dDateStr = (data.createdAt || data.timestamp)
          ? new Date(data.createdAt || data.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
          : "\u2014";
        body.appendChild(h("div", { className: "event-panel-meta" }, "Dismissal  \u00B7  " + dDateStr));

        // Reason badge (large)
        body.appendChild(h("div", { className: "event-panel-section-label" }, "Reason"));
        body.appendChild(h("div", { style: "margin-bottom:0.75rem" }, reasonBadge(data.reason)));

        // Note
        if (data.note) {
          body.appendChild(h("div", { className: "event-panel-section-label" }, "Note"));
          body.appendChild(h("div", { className: "event-panel-response" }, data.note));
        }

        // Re-queue status
        body.appendChild(h("div", { className: "event-panel-section-label" }, "Re-queue Status"));
        var requeueText = data.requeued ? "Re-queued for next session" : "Not re-queued";
        body.appendChild(h("div", { style: "font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.5rem" }, requeueText));

        // Resolution
        if (data.resolvedAs) {
          body.appendChild(h("div", { className: "event-panel-section-label" }, "Resolution"));
          body.appendChild(h("div", { style: "font-size:0.8rem;color:var(--text-secondary)" }, resolutionLabel(data.resolvedAs, data.resolvedAt)));
        }

        return;
      }

      // Concept name + domain
      var conceptName = (data.conceptName || data.conceptId || "").replace(/-/g, " ").replace(/\//g, " \u203A ");
      var conceptLink = h("span", {
        className: "event-panel-concept-name",
        onclick: function() { closeEventPanel(); navigateToConcept(data.conceptId); }
      }, conceptName);

      var conceptRow = h("div", { className: "event-panel-concept" }, [conceptLink]);
      if (data.domain) {
        var domainBadge = h("span", {
          className: "domain-badge event-panel-link",
          onclick: function() {
            closeEventPanel();
            // Navigate to concepts tab filtered by domain
            var conceptsBtn = document.getElementById("tabBtn-concepts");
            if (conceptsBtn) switchTab(conceptsBtn);
            renderConceptsTab();
            // After render, click the domain filter
            setTimeout(function() {
              var filterBtns = document.querySelectorAll(".filter-btn");
              for (var j = 0; j < filterBtns.length; j++) {
                if (filterBtns[j].textContent === data.domain) { filterBtns[j].click(); break; }
              }
            }, 200);
          }
        }, data.domain);
        conceptRow.appendChild(domainBadge);
      }
      body.appendChild(conceptRow);

      // Date + event type
      var typeLabel = data.eventType === "probe" ? "Probe"
        : data.eventType === "tutor_phase1" ? "Tutor P1"
        : data.eventType === "tutor_phase4" ? "Tutor P4"
        : data.eventType || "\u2014";
      var dateStr = data.createdAt ? new Date(data.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014";
      body.appendChild(h("div", { className: "event-panel-meta" }, typeLabel + "  \u00B7  " + dateStr));

      // Score row: rubric, mastery delta, integrity
      var rubricScore = data.rubricScore !== undefined && data.rubricScore !== null ? data.rubricScore : "\u2014";
      var rubricEl = h("div", { className: "event-panel-score-item" }, [
        h("div", { className: "event-panel-score-value score-badge score-" + rubricScore }, rubricScore + "/3"),
        h("div", { className: "event-panel-score-label" }, "Score")
      ]);

      var masteryDelta = "";
      var deltaCls = "";
      if (data.muBefore !== undefined && data.muAfter !== undefined) {
        var pBefore = Math.round(pMastery(data.muBefore) * 100);
        var pAfter = Math.round(pMastery(data.muAfter) * 100);
        var delta = pAfter - pBefore;
        masteryDelta = pBefore + "% \u2192 " + pAfter + "%";
        deltaCls = delta > 0 ? "trend-up" : delta < 0 ? "trend-down" : "trend-flat";
      }
      var masteryEl = h("div", { className: "event-panel-score-item event-panel-link", onclick: function() {
        closeEventPanel();
        navigateToConcept(data.conceptId);
      }}, [
        h("div", { className: "event-panel-score-value " + deltaCls, style: "font-size:0.85rem" }, masteryDelta || "\u2014"),
        h("div", { className: "event-panel-score-label" }, "Mastery")
      ]);

      var integrityPct = data.integrityScore !== undefined && data.integrityScore !== null
        ? (data.integrityScore * 100).toFixed(0) + "%" : "\u2014";
      var integrityColor = data.integrityScore !== null && data.integrityScore !== undefined
        ? (data.integrityScore < 0.5 ? "color:var(--red)" : data.integrityScore < 0.8 ? "color:var(--amber)" : "color:var(--green)")
        : "";
      var integrityEl = h("div", { className: "event-panel-score-item event-panel-link", onclick: function() {
        closeEventPanel();
        // Navigate to integrity tab
        var integrityBtn = document.getElementById("tabBtn-integrity");
        if (integrityBtn) switchTab(integrityBtn);
      }}, [
        h("div", { className: "event-panel-score-value", style: integrityColor }, integrityPct),
        h("div", { className: "event-panel-score-label" }, "Integrity")
      ]);

      body.appendChild(h("div", { className: "event-panel-scores" }, [rubricEl, masteryEl, integrityEl]));

      // Evaluation criteria
      if (data.evaluationCriteria) {
        body.appendChild(h("div", { className: "event-panel-section-label" }, "Evaluation Criteria"));
        body.appendChild(h("div", { className: "event-panel-criteria", title: data.evaluationCriteria }, data.evaluationCriteria));
      }

      // Response text (expandable)
      if (data.responseText) {
        body.appendChild(h("div", { className: "event-panel-section-label" }, "Response"));
        var responseEl = h("div", { className: "event-panel-response", onclick: function() {
          if (responseEl.classList.contains("expanded")) return;
          responseEl.classList.add("expanded");
        }}, data.responseText);
        body.appendChild(responseEl);
      }

      // Signals chips
      var features = data.responseFeatures;
      if (features && typeof features === "object") {
        var signalContainer = h("div", { className: "event-panel-signals" });
        if (features.charsPerSecond !== undefined) {
          signalContainer.appendChild(h("span", { className: "event-panel-signal" }, [
            h("span", null, "Speed: "),
            h("span", { className: "event-panel-signal-value" }, features.charsPerSecond.toFixed(1) + " c/s")
          ]));
        }
        if (features.wordCount !== undefined) {
          signalContainer.appendChild(h("span", { className: "event-panel-signal" }, [
            h("span", null, "Words: "),
            h("span", { className: "event-panel-signal-value" }, String(features.wordCount))
          ]));
        }
        if (features.formattingScore !== undefined) {
          signalContainer.appendChild(h("span", { className: "event-panel-signal" }, [
            h("span", null, "Fmt: "),
            h("span", { className: "event-panel-signal-value" }, String(features.formattingScore))
          ]));
        }
        body.appendChild(signalContainer);
      }

      // Annotations (admin only)
      if (options.isAdmin) {
        body.appendChild(h("div", { className: "event-panel-section-label" }, "Annotations"));
        var annotationsContainer = h("div", { className: "event-panel-annotations" });

        var annotations = data.annotations || [];
        if (annotations.length === 0) {
          annotationsContainer.appendChild(h("div", { style: "font-size:0.8rem;color:var(--text-tertiary)" }, "No annotations yet."));
        } else {
          annotations.forEach(function(ann) {
            var deleteBtn = null;
            if (currentUser && ann.authorId === currentUser.id) {
              deleteBtn = h("button", { className: "event-panel-annotation-delete", onclick: function() {
                fetch("/api/org/annotations/" + ann.id, { method: "DELETE", headers: getHeaders() })
                  .then(function(r) {
                    if (r.ok) {
                      // Refresh annotation list
                      data.annotations = data.annotations.filter(function(a) { return a.id !== ann.id; });
                      renderPanelContent(data);
                    }
                  });
              }}, "\u00D7");
            }
            annotationsContainer.appendChild(h("div", { className: "event-panel-annotation" }, [
              h("div", { className: "event-panel-annotation-header" }, [
                h("span", null, [
                  h("span", { className: "event-panel-annotation-author" }, ann.authorName || "Admin"),
                  h("span", { className: "event-panel-annotation-time" }, "  \u00B7  " + timeAgo(ann.createdAt))
                ]),
                deleteBtn
              ]),
              h("div", { className: "event-panel-annotation-text" }, ann.text)
            ]));
          });
        }

        // Add annotation form
        var textarea = h("textarea", { placeholder: "Add annotation\u2026", rows: "2" });
        var submitBtn = h("button", { className: "btn-sm primary", onclick: function() {
          var text = textarea.value.trim();
          if (!text || !data.id) return;
          submitBtn.disabled = true;
          fetch("/api/org/events/" + data.id + "/annotations", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ text: text })
          })
            .then(function(r) { return r.json(); })
            .then(function(newAnn) {
              if (!data.annotations) data.annotations = [];
              data.annotations.push(newAnn);
              renderPanelContent(data);
            })
            .catch(function() { submitBtn.disabled = false; });
        }}, "Add");
        annotationsContainer.appendChild(h("div", { className: "event-panel-add-annotation" }, [textarea, submitBtn]));

        body.appendChild(annotationsContainer);
      }
    }
  }

  // Fetch a single event detail for the current user
  function fetchEventDetail(eventId) {
    return fetch("/api/events/" + eventId, { headers: getHeaders() })
      .then(function(r) { return r.json(); });
  }

  // Fetch a single event detail via org endpoint (admin)
  function fetchOrgEventDetail(eventId) {
    return fetch("/api/org/events/" + eventId, { headers: getHeaders() })
      .then(function(r) { return r.json(); });
  }

  // --- Real-time updates via SSE ---

  var eventSource = null;
  var sseReady = false;

  function connectSSE() {
    if (eventSource) eventSource.close();
    sseReady = false;
    var url = "/api/events";
    if (token) {
      // EventSource doesn't support custom headers, use query param
      url += "?token=" + encodeURIComponent(token);
    }
    eventSource = new EventSource(url, { withCredentials: true });

    eventSource.addEventListener("mastery_update", function(e) {
      var data = JSON.parse(e.data);
      handleMasteryUpdate(data);
    });

    eventSource.addEventListener("connected", function() {
      showLiveIndicator(true);
      // Suppress toasts for buffered events; only show for real-time updates
      setTimeout(function() { sseReady = true; }, 500);
    });

    eventSource.onerror = function() {
      showLiveIndicator(false);
    };
  }

  function handleMasteryUpdate(data) {
    // Update concept mastery in the local map
    if (allMasteryMap[data.conceptId]) {
      allMasteryMap[data.conceptId].mu = -Math.log(100 / data.masteryAfter - 1);
      allMasteryMap[data.conceptId].lastAssessed = data.createdAt;
    }

    // Update sessionStorage cache
    var cached = cacheGet("data");
    if (cached) {
      for (var i = 0; i < cached.mastery.length; i++) {
        if (cached.mastery[i].conceptId === data.conceptId) {
          cached.mastery[i].mu = allMasteryMap[data.conceptId].mu;
          cached.mastery[i].lastAssessed = data.createdAt;
          break;
        }
      }
      cacheSet("data", cached);
    }

    // Re-render the currently visible tab
    var activeTab = document.querySelector(".tab-btn.active");
    var tabName = activeTab ? activeTab.getAttribute("data-tab") : "overview";
    if (tabName === "concepts") {
      renderConceptsTab();
    } else if (tabName === "overview") {
      loadActivity();
    }

    // Only toast for real-time updates, not buffered events on connect
    if (sseReady) showUpdateToast(data);
  }

  function showLiveIndicator(connected) {
    var meta = document.getElementById("header-meta");
    if (!meta) return;
    meta.textContent = connected ? "Live" : "";
    meta.style.color = connected ? "var(--green)" : "var(--text-tertiary)";
  }

  var activeToast = null;

  function showUpdateToast(data) {
    // Dismiss previous toast
    if (activeToast) { activeToast.remove(); activeToast = null; }

    var delta = data.masteryAfter - data.masteryBefore;
    var sign = delta >= 0 ? "+" : "";
    var msg = data.conceptId + ": " + data.masteryBefore + "% \u2192 " + data.masteryAfter + "% (" + sign + delta + "%)";

    var toast = h("div", { className: "toast" }, msg);
    activeToast = toast;
    document.body.appendChild(toast);
    setTimeout(function() { toast.classList.add("show"); }, 10);
    setTimeout(function() {
      toast.classList.remove("show");
      setTimeout(function() { if (activeToast === toast) activeToast = null; toast.remove(); }, 300);
    }, 3000);
  }

  // --- Init ---

  // Handle OAuth callback: when redirected back after social login,
  // try session-based auth (cookie) via /api/me with credentials
  function trySessionAuth() {
    return fetch("/api/me", { credentials: "include" })
      .then(function(r) {
        if (r.ok) return r.json();
        throw new Error("No session");
      })
      .then(function(data) {
        if (data.user) {
          currentUser = data.user;
          return true;
        }
        return false;
      })
      .catch(function() { return false; });
  }

  if (token) {
    fetch("/api/me", { headers: getHeaders() })
      .then(function(r) {
        if (r.ok) return r.json();
        throw new Error("Unauthorized");
      })
      .then(function(data) { currentUser = data.user; showDashboard(); })
      .catch(function() {
        localStorage.removeItem("entendi_token"); token = null;
        // Try session-based auth (OAuth callback case)
        trySessionAuth().then(function(ok) {
          if (ok) showDashboard();
          else showAuth();
        });
      });
  } else {
    // No token: try session auth (OAuth redirect case)
    trySessionAuth().then(function(ok) {
      if (ok) showDashboard();
      else showAuth();
    });
  }
})();
