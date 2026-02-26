(function() {
  "use strict";
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

  // --- Tabs ---

  function initTabs() {
    var btns = document.querySelectorAll(".tab-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function() {
        var tab = this.getAttribute("data-tab");
        for (var j = 0; j < btns.length; j++) btns[j].classList.remove("active");
        this.classList.add("active");
        document.querySelectorAll(".tab-content").forEach(function(tc) { tc.classList.remove("active"); });
        var target = document.getElementById("tab-" + tab);
        if (target) target.classList.add("active");

        if (tab === "settings") renderSettings();
        if (tab === "organization") renderOrganization();
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
      h("button", { onclick: function() { fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "include" }).finally(function() { localStorage.removeItem("entendi_token"); token = null; location.reload(); }); } }, "Sign out")
    ]);
    bar.appendChild(userBar);

    initTabs();
    loadData();
    connectSSE();
  }

  function loadData() {
    Promise.all([
      fetch("/api/concepts", { headers: getHeaders() }).then(function(r) { return r.json(); }),
      fetch("/api/mastery", { headers: getHeaders() }).then(function(r) { return r.json(); }),
      fetch("/api/mcp/status", { headers: getHeaders() }).then(function(r) { return r.json(); }),
      fetch("/api/mcp/zpd-frontier", { headers: getHeaders() }).then(function(r) { return r.json(); }),
    ]).then(function(results) {
      renderStats(results[2]);
      renderZpdFrontier(results[3]);
      renderConcepts(results[0], results[1]);
      loadActivity();
    });
  }

  function renderZpdFrontier(data) {
    var section = document.getElementById("zpd-section");
    var container = document.getElementById("zpd-list");
    container.textContent = "";
    if (!data.frontier || data.frontier.length === 0) { section.style.display = "none"; return; }
    section.style.display = "block";

    var items = data.frontier.slice(0, 12);
    items.forEach(function(item) {
      var pct = Math.round(item.mastery * 100);
      var dot = h("span", { className: "zpd-dot" });
      dot.style.background = masteryColor(pct);
      var chip = h("span", { className: "zpd-chip" }, [
        dot,
        h("span", null, item.conceptId),
        h("span", { className: "zpd-mastery" }, pct + "%")
      ]);
      container.appendChild(chip);
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
    deleteBtn.style.background = "white";
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

    if (sub && sub.plan) {
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

    if (sub && sub.earnedFreeUntil && planName === "Earned Free") {
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
      if (newName && newName.trim() && newName.trim() !== org.name) {
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

    loadPendingInvites(org.id);
    loadMembers(org.id);
    loadRankings(org.id);
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
          revokeBtn.style.background = "white";
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

          var row = h("div", { className: "member-row" }, [
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

  function loadRankings(orgId) {
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

  // --- Real-time updates via SSE ---

  var eventSource = null;

  function connectSSE() {
    if (eventSource) eventSource.close();
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
    });

    eventSource.onerror = function() {
      showLiveIndicator(false);
    };
  }

  function handleMasteryUpdate(data) {
    // Update concept mastery in the grid if visible
    if (allMasteryMap[data.conceptId]) {
      // Update mu from mastery percentage back to mu (approximate)
      allMasteryMap[data.conceptId].mu = -Math.log(100 / data.masteryAfter - 1);
      allMasteryMap[data.conceptId].lastAssessed = data.createdAt;
      // Re-render the current filter
      var activeFilter = document.querySelector(".filter-btn.active");
      var domain = activeFilter && activeFilter.textContent !== "All" ? activeFilter.textContent : null;
      renderConceptList(domain);
    }

    // Flash notification
    showUpdateToast(data);
  }

  function showLiveIndicator(connected) {
    var meta = document.getElementById("header-meta");
    if (!meta) return;
    meta.textContent = connected ? "Live" : "";
    meta.style.color = connected ? "var(--green)" : "var(--text-tertiary)";
  }

  function showUpdateToast(data) {
    var delta = data.masteryAfter - data.masteryBefore;
    var sign = delta >= 0 ? "+" : "";
    var msg = data.conceptId + ": " + data.masteryBefore + "% \u2192 " + data.masteryAfter + "% (" + sign + delta + "%)";

    var toast = h("div", { className: "toast" }, msg);
    document.body.appendChild(toast);
    setTimeout(function() { toast.classList.add("show"); }, 10);
    setTimeout(function() {
      toast.classList.remove("show");
      setTimeout(function() { toast.remove(); }, 300);
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
