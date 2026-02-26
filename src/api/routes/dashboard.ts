import { Hono } from 'hono';
import type { Env } from '../index.js';

export const dashboardRoutes = new Hono<Env>();

dashboardRoutes.get('/', (c) => {
  return c.html(getDashboardHTML());
});

dashboardRoutes.get('/link', (c) => {
  const code = c.req.query('code') || '';
  return c.html(getDeviceLinkHTML(code));
});

// NOTE: All dynamic content in the dashboard frontend uses textContent or
// safe DOM construction (createElement + textContent). No innerHTML with
// untrusted data — concept IDs and domain names come from the API but are
// rendered via textContent, not innerHTML. SVG icons for social login buttons
// are rendered as static HTML in the server template string (not via JS innerHTML).

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Entendi</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231a1a2e'/%3E%3Cpath d='M 19.5 7 C 19.5 3.5 15.5 3.5 15.5 7 L 15.5 22' stroke='white' stroke-width='3' stroke-linecap='round' fill='none'/%3E%3Ccircle cx='15.5' cy='27' r='2' fill='white'/%3E%3C/svg%3E"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300&display=swap" rel="stylesheet"/>
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
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    .header h1 { font-family: 'Space Grotesk', sans-serif; font-size: 1.5rem; font-weight: 300; letter-spacing: -0.03em; color: #1a1a2e; display: flex; align-items: baseline; gap: 0; }
    .header h1 .logo-mark { display: inline-block; width: 0.55em; height: auto; vertical-align: baseline; margin-bottom: -0.15em; }
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

    /* Social login */
    .social-btns { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
    .btn-social {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      width: 100%; padding: 0.55rem; border: 1px solid var(--border); border-radius: 6px;
      background: var(--bg-card); color: var(--text); font-size: 0.85rem; font-weight: 500;
      cursor: pointer; transition: all 0.15s; text-decoration: none;
    }
    .btn-social:hover { border-color: var(--border-hover); background: var(--bg); }
    .btn-social svg { width: 18px; height: 18px; flex-shrink: 0; }
    .divider {
      display: flex; align-items: center; gap: 0.75rem; margin: 0.75rem 0;
      font-size: 0.75rem; color: var(--text-tertiary);
    }
    .divider::before, .divider::after {
      content: ""; flex: 1; height: 1px; background: var(--border);
    }

    /* User bar */
    .user-bar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0; margin-bottom: 0; border-bottom: 1px solid var(--border);
      font-size: 0.8rem; color: var(--text-secondary);
    }
    .user-bar button {
      background: none; border: none; color: var(--text-tertiary); cursor: pointer;
      font-size: 0.8rem;
    }
    .user-bar button:hover { color: var(--text); }

    /* Tabs */
    .tabs {
      display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 2rem;
    }
    .tab-btn {
      padding: 0.65rem 1.25rem; border: none; background: none;
      font-size: 0.8rem; font-weight: 500; color: var(--text-tertiary);
      cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
      transition: all 0.15s;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

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

    /* ZPD frontier */
    .zpd-list { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .zpd-chip {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.35rem 0.75rem; border-radius: 6px;
      border: 1px solid var(--border); background: var(--bg-card);
      font-family: var(--mono); font-size: 0.75rem; font-weight: 500;
      color: var(--text); cursor: default; transition: border-color 0.15s;
    }
    .zpd-chip:hover { border-color: var(--accent); }
    .zpd-mastery { font-size: 0.65rem; color: var(--text-tertiary); font-weight: 400; }
    .zpd-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

    /* Empty states */
    .empty-state { text-align: center; padding: 2rem; color: var(--text-tertiary); font-size: 0.85rem; }

    /* API Key cards */
    .key-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
    .key-card {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1rem; background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 8px; font-size: 0.85rem;
    }
    .key-card-info { display: flex; flex-direction: column; gap: 0.15rem; }
    .key-card-name { font-weight: 500; }
    .key-card-preview { font-family: var(--mono); font-size: 0.75rem; color: var(--text-tertiary); }
    .key-card-actions { display: flex; gap: 0.5rem; }
    .key-new {
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      padding: 0.75rem 1rem; background: var(--accent-light); border: 1px dashed var(--accent);
      border-radius: 8px; font-size: 0.85rem; color: var(--accent); font-weight: 500;
      cursor: pointer; transition: all 0.15s;
    }
    .key-new:hover { background: #dbeafe; }
    .key-reveal {
      padding: 0.75rem 1rem; background: var(--green-bg); border: 1px solid var(--green);
      border-radius: 8px; font-size: 0.85rem; margin-bottom: 1rem;
    }
    .key-reveal-value {
      font-family: var(--mono); font-size: 0.8rem; word-break: break-all;
      padding: 0.5rem; background: var(--bg); border-radius: 4px; margin: 0.5rem 0;
    }
    .btn-copy {
      padding: 0.3rem 0.75rem; border: 1px solid var(--border); border-radius: 4px;
      background: var(--bg-card); color: var(--text); font-size: 0.75rem;
      cursor: pointer; transition: all 0.15s;
    }
    .btn-copy:hover { border-color: var(--accent); color: var(--accent); }
    .btn-danger {
      padding: 0.3rem 0.75rem; border: 1px solid var(--red); border-radius: 4px;
      background: var(--bg-card); color: var(--red); font-size: 0.75rem;
      cursor: pointer; transition: all 0.15s;
    }
    .btn-danger:hover { background: var(--red-bg); }
    .btn-sm {
      padding: 0.35rem 0.75rem; border: 1px solid var(--border); border-radius: 6px;
      background: var(--bg-card); color: var(--text); font-size: 0.8rem; font-weight: 500;
      cursor: pointer; transition: all 0.15s;
    }
    .btn-sm:hover { border-color: var(--accent); color: var(--accent); }
    .btn-sm.primary { background: var(--accent); color: white; border-color: var(--accent); }
    .btn-sm.primary:hover { background: #1d4ed8; }

    /* Three-dot dropdown menu */
    .dot-menu { position: relative; display: inline-block; }
    .dot-menu-trigger {
      background: none; border: 1px solid transparent; border-radius: 6px;
      cursor: pointer; font-size: 1.25rem; line-height: 1; padding: 0.2rem 0.5rem;
      color: var(--text-secondary); transition: all 0.15s;
    }
    .dot-menu-trigger:hover { background: var(--bg); border-color: var(--border); color: var(--text); }
    .dot-menu-dropdown {
      display: none; position: absolute; right: 0; top: 100%; margin-top: 4px;
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08); min-width: 160px; z-index: 100;
      padding: 4px 0; overflow: hidden;
    }
    .dot-menu-dropdown.open { display: block; }
    .dot-menu-item {
      display: block; width: 100%; padding: 0.5rem 0.75rem; border: none; background: none;
      text-align: left; font-size: 0.8rem; color: var(--text); cursor: pointer; transition: background 0.1s;
    }
    .dot-menu-item:hover { background: var(--bg); }
    .dot-menu-item.danger { color: var(--red); }
    .dot-menu-item.danger:hover { background: var(--red-bg); }

    /* Setup instructions */
    .setup-instructions {
      margin-top: 1.5rem; padding: 1rem; background: var(--bg);
      border: 1px solid var(--border); border-radius: 8px;
    }
    .setup-instructions h4 { font-size: 0.8rem; font-weight: 600; margin-bottom: 0.5rem; }
    .setup-instructions code {
      display: block; padding: 0.5rem 0.75rem; background: var(--bg-card);
      border: 1px solid var(--border); border-radius: 4px;
      font-family: var(--mono); font-size: 0.75rem; color: var(--text);
      margin-top: 0.25rem; word-break: break-all;
    }

    /* Org management */
    .org-form {
      display: flex; gap: 0.5rem; margin-bottom: 1rem; align-items: flex-end;
    }
    .org-form input, .org-form select {
      flex: 1; padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 6px;
      font-size: 0.85rem; background: var(--bg); color: var(--text); outline: none;
    }
    .org-form input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    .member-list { display: flex; flex-direction: column; gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .member-row {
      display: grid; grid-template-columns: 1fr 100px 80px 60px;
      align-items: center; padding: 0.6rem 1rem; background: var(--bg-card);
      font-size: 0.85rem; gap: 0.5rem;
    }
    .member-row:hover { background: #f9fafb; }
    .member-name { font-weight: 500; }
    .member-email { font-size: 0.75rem; color: var(--text-tertiary); }
    .member-role {
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--text-secondary); font-weight: 600;
    }
    .member-mastery { font-size: 0.8rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .ranking-table { width: 100%; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; border-spacing: 0; }
    .ranking-table th {
      text-align: left; padding: 0.5rem 1rem; font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--text-tertiary); font-weight: 600;
      background: #f9fafb; border-bottom: 1px solid var(--border);
    }
    .ranking-table td { padding: 0.5rem 1rem; font-size: 0.8rem; border-bottom: 1px solid var(--border); }
    .ranking-table tr:last-child td { border-bottom: none; }

    /* Billing */
    .plan-card {
      padding: 1.25rem; background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 8px; margin-bottom: 1rem;
    }
    .plan-card.current { border-color: var(--accent); }
    .plan-name { font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem; }
    .plan-price { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
    .plan-features { font-size: 0.8rem; color: var(--text-secondary); list-style: none; }
    .plan-features li { padding: 0.15rem 0; }
    .plan-features li::before { content: "\\2713  "; color: var(--green); font-weight: 600; }
    .earned-free-progress {
      margin-top: 1rem; padding: 0.75rem 1rem; background: var(--amber-bg);
      border: 1px solid var(--amber); border-radius: 8px; font-size: 0.8rem;
    }

    /* Email preferences */
    .pref-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 0; border-bottom: 1px solid var(--border);
    }
    .pref-label { font-size: 0.85rem; }
    .pref-desc { font-size: 0.75rem; color: var(--text-tertiary); }
    .pref-row select {
      padding: 0.35rem 0.5rem; border: 1px solid var(--border); border-radius: 4px;
      font-size: 0.8rem; background: var(--bg-card); color: var(--text); outline: none;
    }
    .toggle {
      position: relative; width: 40px; height: 22px; border-radius: 11px;
      background: var(--border); cursor: pointer; transition: background 0.2s;
      border: none;
    }
    .toggle.on { background: var(--accent); }
    .toggle::after {
      content: ""; position: absolute; top: 2px; left: 2px;
      width: 18px; height: 18px; border-radius: 50%;
      background: white; transition: transform 0.2s;
    }
    .toggle.on::after { transform: translateX(18px); }

    /* Responsive */
    @media (max-width: 640px) {
      .stats-row { grid-template-columns: repeat(2, 1fr); }
      .concept-row { grid-template-columns: 1fr 80px; }
      .concept-header { grid-template-columns: 1fr 80px; }
      .confidence-cell, .assessments-cell, .concept-header > *:nth-child(3), .concept-header > *:nth-child(4) { display: none; }
      .member-row { grid-template-columns: 1fr 80px; }
      .member-row > *:nth-child(3), .member-row > *:nth-child(4) { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="auth-area"></div>
    <div id="content" style="display:none;">
      <div class="header">
        <h1>entend<svg class="logo-mark" viewBox="0 0 26 75" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M 21 11 C 21 2 12 2 12 11 L 12 55" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" fill="none"/><circle cx="12" cy="69" r="5" fill="currentColor"/></svg></h1>
        <div class="header-meta" id="header-meta"></div>
      </div>
      <div id="user-bar"></div>
      <div class="tabs" id="tabs">
        <button class="tab-btn active" data-tab="overview">Overview</button>
        <button class="tab-btn" data-tab="organization">Organization</button>
        <button class="tab-btn" data-tab="settings">Settings</button>
      </div>

      <div class="tab-content active" id="tab-overview">
        <div class="stats-row" id="stats-row"></div>

        <div class="section" id="zpd-section" style="display:none;">
          <div class="section-header">
            <div class="section-title">Ready to Learn</div>
            <div class="section-subtitle">Concepts with mastered prerequisites</div>
          </div>
          <div class="zpd-list" id="zpd-list"></div>
        </div>

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

      <div class="tab-content" id="tab-organization">
        <div id="org-area"></div>
      </div>

      <div class="tab-content" id="tab-settings">
        <div id="settings-area"></div>
      </div>
    </div>
  </div>

  <!-- Social login button templates (static SVG, hidden, cloned by JS) -->
  <template id="tpl-github-btn">
    <a class="btn-social" href="/api/auth/sign-in/social?provider=github&amp;callbackURL=/">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
      Sign in with GitHub
    </a>
  </template>
  <template id="tpl-google-btn">
    <a class="btn-social" href="/api/auth/sign-in/social?provider=google&amp;callbackURL=/">
      <svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
      Sign in with Google
    </a>
  </template>

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
        if (count === 0) return { text: "\\u2014", cls: "confidence-low" };
        if (sigma < 0.4) return { text: "High", cls: "confidence-high" };
        if (sigma < 0.8) return { text: "Med", cls: "confidence-med" };
        return { text: "Low", cls: "confidence-low" };
      }

      function timeAgo(dateStr) {
        if (!dateStr) return "\\u2014";
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
            h("input", { type: "password", id: "auth-pass", placeholder: "\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022" })
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
            document.getElementById("auth-error").textContent = "Network error \\u2014 is the API running?";
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
              h("div", { className: "mastery-pct" }, pct >= 0 ? pct + "%" : "\\u2014")
            ]),
            h("div", { className: "confidence-cell " + conf.cls }, conf.text),
            h("div", { className: "assessments-cell" }, count > 0 ? String(count) : "\\u2014")
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
              var span = h("span", null, pBefore + "% \\u2192 " + pAfter + "%  ");
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
                : "\\u2014";
              var masteryInfo = m.mastery
                ? m.mastery.mastered + "/" + m.mastery.totalAssessed + " mastered"
                : "";

              var emailSpan = h("div", { className: "member-email" }, m.email);
              var infoSpan = h("div", null, "");
              infoSpan.style.fontSize = "0.7rem";
              infoSpan.style.color = "var(--text-tertiary)";
              infoSpan.textContent = masteryInfo;

              var actions = h("div", { style: "display:flex;gap:4px;align-items:center;" });
              if (m.role !== "owner") {
                var roleToggle = h("button", {
                  className: "btn-sm",
                  onclick: function() { updateMemberRole(m.userId, m.role === "admin" ? "member" : "admin", orgId); }
                }, m.role === "admin" ? "Demote" : "Promote");
                roleToggle.style.fontSize = "0.65rem";
                roleToggle.style.padding = "0.15rem 0.4rem";
                roleToggle.style.border = "1px solid var(--border)";
                roleToggle.style.background = "white";
                roleToggle.style.borderRadius = "4px";
                roleToggle.style.cursor = "pointer";
                actions.appendChild(roleToggle);

                var removeBtn = h("button", {
                  className: "btn-sm",
                  onclick: function() { removeMember(m.userId, orgId); }
                }, "Remove");
                removeBtn.style.fontSize = "0.65rem";
                removeBtn.style.padding = "0.15rem 0.4rem";
                removeBtn.style.color = "var(--red)";
                removeBtn.style.border = "1px solid var(--border)";
                removeBtn.style.background = "white";
                removeBtn.style.borderRadius = "4px";
                removeBtn.style.cursor = "pointer";
                actions.appendChild(removeBtn);
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
                h("td", null, r.avgMastery ? Math.round(r.avgMastery * 100) + "%" : "\\u2014"),
                h("td", null, String(r.totalAssessed || 0))
              ]);
              tbody.appendChild(row);
            });
            table.appendChild(tbody);
            area.appendChild(table);
          })
          .catch(function() {});
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
  </script>
</body>
</html>`;
}

function getDeviceLinkHTML(code: string): string {
  // Validate code is alphanumeric to prevent injection
  const safeCode = code.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Link Device - Entendi</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231a1a2e'/%3E%3Cpath d='M 19.5 7 C 19.5 3.5 15.5 3.5 15.5 7 L 15.5 22' stroke='white' stroke-width='3' stroke-linecap='round' fill='none'/%3E%3Ccircle cx='15.5' cy='27' r='2' fill='white'/%3E%3C/svg%3E"/>
  <style>
    :root {
      --bg: #fafafa; --bg-card: #ffffff; --border: #e5e7eb;
      --text: #111827; --text-secondary: #6b7280; --text-tertiary: #9ca3af;
      --accent: #2563eb; --green: #16a34a; --green-bg: #f0fdf4; --red: #dc2626;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Helvetica, Arial, sans-serif;
      background: var(--bg); color: var(--text); min-height: 100vh; -webkit-font-smoothing: antialiased;
      display: flex; align-items: center; justify-content: center;
    }
    .link-container {
      max-width: 420px; padding: 2rem; background: var(--bg-card);
      border: 1px solid var(--border); border-radius: 12px; text-align: center;
    }
    h2 { font-size: 1.1rem; margin-bottom: 0.5rem; }
    .subtitle { font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem; }
    .code-display {
      font-family: 'SF Mono', 'Cascadia Code', monospace;
      font-size: 1.75rem; font-weight: 700; letter-spacing: 0.15em;
      padding: 0.75rem 1.5rem; background: var(--bg); border: 1px solid var(--border);
      border-radius: 8px; margin-bottom: 1.5rem; display: inline-block;
    }
    .btn-confirm {
      width: 100%; padding: 0.65rem; border: none; border-radius: 6px;
      background: var(--accent); color: white; font-size: 0.9rem; font-weight: 600;
      cursor: pointer;
    }
    .btn-confirm:hover { background: #1d4ed8; }
    .btn-confirm:disabled { background: var(--border); cursor: not-allowed; }
    .status { margin-top: 1rem; font-size: 0.85rem; }
    .status.success { color: var(--green); }
    .status.error { color: var(--red); }
    .auth-prompt { margin-top: 1rem; }
    .auth-prompt a { color: var(--accent); text-decoration: none; font-weight: 500; }
    .auth-prompt a:hover { text-decoration: underline; }
    .inline-login { text-align: left; margin-top: 1rem; }
    .inline-login label { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem; margin-top: 0.75rem; }
    .inline-login input {
      width: 100%; padding: 0.5rem 0.65rem; border: 1px solid var(--border); border-radius: 6px;
      font-size: 0.85rem; outline: none;
    }
    .inline-login input:focus { border-color: var(--accent); }
    .inline-login .btn-confirm { margin-top: 1rem; }
    .login-error { color: var(--red); font-size: 0.8rem; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="link-container">
    <h2>Link Device</h2>
    <div class="subtitle">Confirm linking this device to your Entendi account</div>
    <div class="code-display" id="device-code"></div>
    <div id="link-content"></div>
    <div class="status" id="link-status"></div>
  </div>
  <script>
    (function() {
      "use strict";
      var code = ${JSON.stringify(safeCode)};
      var codeEl = document.getElementById("device-code");
      codeEl.textContent = code;

      if (!code) {
        document.getElementById("link-status").textContent = "No device code provided.";
        document.getElementById("link-status").className = "status error";
        return;
      }

      var token = localStorage.getItem("entendi_token");

      function getHeaders() {
        var headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = "Bearer " + token;
        return headers;
      }

      function checkAuth() {
        if (token) {
          return fetch("/api/me", { headers: getHeaders() })
            .then(function(r) { if (r.ok) return r.json(); throw new Error("unauth"); })
            .then(function(data) { return data.user; });
        }
        return fetch("/api/me", { credentials: "include" })
          .then(function(r) { if (r.ok) return r.json(); throw new Error("unauth"); })
          .then(function(data) { return data.user; });
      }

      function showConfirm(user) {
        var content = document.getElementById("link-content");
        content.textContent = "";
        var info = document.createElement("div");
        info.style.cssText = "font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem;";
        info.textContent = "Linking as " + (user.name || user.email);
        content.appendChild(info);

        var btn = document.createElement("button");
        btn.className = "btn-confirm";
        btn.textContent = "Confirm Link";
        btn.onclick = function() {
          btn.disabled = true;
          btn.textContent = "Linking...";
          fetch("/api/auth/device-code/" + encodeURIComponent(code) + "/confirm", {
            method: "POST",
            headers: getHeaders(),
            credentials: "include"
          })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              var status = document.getElementById("link-status");
              if (data.error) {
                status.textContent = data.error;
                status.className = "status error";
                btn.disabled = false;
                btn.textContent = "Confirm Link";
              } else {
                status.textContent = "Device linked successfully! You can close this page.";
                status.className = "status success";
                btn.style.display = "none";
              }
            })
            .catch(function() {
              var status = document.getElementById("link-status");
              status.textContent = "Network error. Please try again.";
              status.className = "status error";
              btn.disabled = false;
              btn.textContent = "Confirm Link";
            });
        };
        content.appendChild(btn);
      }

      function showLogin() {
        var content = document.getElementById("link-content");
        content.textContent = "";
        var form = document.createElement("div");
        form.className = "inline-login";

        var emailLabel = document.createElement("label");
        emailLabel.setAttribute("for", "link-email");
        emailLabel.textContent = "Email";
        form.appendChild(emailLabel);

        var emailInput = document.createElement("input");
        emailInput.type = "email";
        emailInput.id = "link-email";
        emailInput.placeholder = "you@example.com";
        form.appendChild(emailInput);

        var passLabel = document.createElement("label");
        passLabel.setAttribute("for", "link-pass");
        passLabel.textContent = "Password";
        form.appendChild(passLabel);

        var passInput = document.createElement("input");
        passInput.type = "password";
        passInput.id = "link-pass";
        passInput.placeholder = "\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022\\u2022";
        form.appendChild(passInput);

        var btn = document.createElement("button");
        btn.className = "btn-confirm";
        btn.id = "link-signin-btn";
        btn.textContent = "Sign in & Link Device";
        form.appendChild(btn);

        var errEl = document.createElement("div");
        errEl.className = "login-error";
        errEl.id = "link-login-error";
        form.appendChild(errEl);

        content.appendChild(form);

        btn.onclick = function() {
          var email = emailInput.value;
          var pass = passInput.value;
          if (!email || !pass) { errEl.textContent = "Email and password required"; return; }
          btn.disabled = true;
          btn.textContent = "Signing in...";
          errEl.textContent = "";
          fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ email: email, password: pass })
          })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.token) {
                token = data.token;
                localStorage.setItem("entendi_token", token);
              }
              if (data.user || data.token) {
                checkAuth()
                  .then(function(user) { showConfirm(user); })
                  .catch(function() { errEl.textContent = "Signed in but auth check failed"; btn.disabled = false; btn.textContent = "Sign in & Link Device"; });
              } else {
                errEl.textContent = data.message || "Sign in failed";
                btn.disabled = false;
                btn.textContent = "Sign in & Link Device";
              }
            })
            .catch(function() {
              errEl.textContent = "Network error";
              btn.disabled = false;
              btn.textContent = "Sign in & Link Device";
            });
        };
      }

      checkAuth()
        .then(function(user) { showConfirm(user); })
        .catch(function() { showLogin(); });
    })();
  </script>
</body>
</html>`;
}
