import { Hono } from 'hono';
import { createHash } from 'crypto';
import { desc } from 'drizzle-orm';
import { manifest } from '../../dashboard/manifest.js';
import { pressMentions } from '../db/schema.js';
import { daysSinceLaunch, publicShell } from './public-html.js';
import type { Env } from '../index.js';

export const dashboardRoutes = new Hono<Env>();

const manifestHash = createHash('md5')
  .update(JSON.stringify(manifest))
  .digest('hex')
  .slice(0, 12);

function getShellHTML(): string {
  const cssHref = manifest['dashboard.css'] || '/assets/dashboard.css';
  const jsHref = manifest['dashboard.js'] || '/assets/dashboard.js';
  const chartsHref = manifest['charts.js'] || '/assets/charts.js';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Entendi</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231a1a2e'/%3E%3Cpath d='M 19.5 7 C 19.5 3.5 15.5 3.5 15.5 7 L 15.5 22' stroke='white' stroke-width='3' stroke-linecap='round' fill='none'/%3E%3Ccircle cx='15.5' cy='27' r='2' fill='white'/%3E%3C/svg%3E"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&display=swap" rel="stylesheet"/>
  <link rel="stylesheet" href="${cssHref}"/>
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
        <button class="tab-btn" data-tab="analytics">Analytics</button>
        <button class="tab-btn" data-tab="concepts">Concepts</button>
        <button class="tab-btn" data-tab="integrity">Integrity</button>
        <button class="tab-btn" data-tab="organization">Organization</button>
        <button class="tab-btn" data-tab="settings">Settings</button>
      </div>

      <div class="tab-content active" id="tab-overview">
        <div style="display:flex;gap:16px;margin-bottom:32px;" id="hero-panels">
          <div style="flex:1;" id="panel-strongest"></div>
          <div style="flex:1;" id="panel-attention"></div>
        </div>
        <div class="section">
          <div class="section-header">
            <div class="section-title">Recent Activity</div>
          </div>
          <div id="activity-area"></div>
        </div>
      </div>

      <div class="tab-content" id="tab-analytics">
        <div class="section">
          <div class="section-header">
            <div class="section-title">Activity</div>
          </div>
          <div class="chart-panel" id="analytics-heatmap" style="height:180px;"></div>
        </div>
        <div class="section">
          <div class="section-header">
            <div class="section-title">Learning Velocity</div>
            <div class="velocity-toggle" id="velocity-toggle"></div>
          </div>
          <div class="chart-panel" id="analytics-velocity" style="height:300px;"></div>
        </div>
        <div class="section">
          <div class="section-header">
            <div class="section-title">Domain Strengths</div>
          </div>
          <div class="chart-panel" id="analytics-radar" style="height:350px;"></div>
        </div>
        <div class="section">
          <div class="section-header">
            <div class="section-title">Review Needed</div>
            <div class="section-subtitle">Concepts predicted to decay</div>
          </div>
          <div class="scroll-container" id="analytics-retention" style="max-height:300px;overflow-y:auto;"></div>
        </div>
      </div>

      <div class="tab-content" id="tab-concepts">
        <div class="section">
          <div class="section-header">
            <div class="section-title">Your Concepts</div>
            <div class="section-subtitle" id="concepts-count"></div>
          </div>
          <div class="filter-row" id="concepts-filter-row"></div>
          <div class="scroll-container" id="concepts-list" style="max-height:600px;overflow-y:auto;"></div>
        </div>
        <div id="concept-detail" style="display:none;"></div>
      </div>

      <div class="tab-content" id="tab-integrity">
        <div class="section">
          <div class="section-header">
            <div class="section-title">Integrity Trend</div>
          </div>
          <div class="chart-panel" id="integrity-trend" style="height:300px;"></div>
        </div>
        <div class="section">
          <div class="section-header">
            <div class="section-title">Flagged Responses</div>
          </div>
          <div id="integrity-dismissals"></div>
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

  <script type="module" src="${chartsHref}"></script>
  <script src="${jsHref}" defer></script>
</body>
</html>`;
}

function getLinkShellHTML(safeCode: string, linkJsHref: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Link Device - Entendi</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231a1a2e'/%3E%3Cpath d='M 19.5 7 C 19.5 3.5 15.5 3.5 15.5 7 L 15.5 22' stroke='white' stroke-width='3' stroke-linecap='round' fill='none'/%3E%3Ccircle cx='15.5' cy='27' r='2' fill='white'/%3E%3C/svg%3E"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: #F6F4F1; --bg-card: #EDEAE5; --border: #E0DCD6;
      --text: #1F1F1F; --text-secondary: #7A7268; --text-tertiary: #9B9389;
      --accent: #C4704B; --green: #5B7B5E; --green-bg: #E8F0E9; --red: #B84233;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg); color: var(--text); min-height: 100vh; -webkit-font-smoothing: antialiased;
      display: flex; align-items: center; justify-content: center;
    }
    .link-container {
      max-width: 420px; padding: 2rem; background: var(--bg-card);
      border: none; border-radius: 12px; text-align: center;
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
    .btn-confirm:hover { background: #A85D3D; }
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
    <div class="code-display" id="device-code" data-code="${safeCode}"></div>
    <div id="link-content"></div>
    <div class="status" id="link-status"></div>
  </div>
  <script src="${linkJsHref}"></script>
</body>
</html>`;
}

function getLandingHTML(): string {
  return publicShell('Entendi — Comprehension accountability for AI-assisted work', 'home', `
  <style>
    .landing { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: calc(100vh - 120px); text-align: center; }
    .landing h1 { font-family: var(--font-display); font-size: 2.25rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; max-width: 600px; margin-bottom: 1.5rem; }
    .landing .subtitle { color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; max-width: 480px; margin-bottom: 2rem; }
    .landing .bullets { list-style: none; text-align: left; max-width: 420px; margin-bottom: 2rem; }
    .landing .bullets li { color: var(--text-secondary); font-size: 0.875rem; line-height: 1.5; padding: 0.35rem 0; padding-left: 1.25rem; position: relative; }
    .landing .bullets li::before { content: '\\2014'; position: absolute; left: 0; color: var(--accent); }
    .demo-placeholder {
      width: 100%; max-width: 480px; height: 240px; background: var(--bg-card);
      border: 1px dashed var(--border); border-radius: 8px; margin-bottom: 2rem;
      display: flex; align-items: center; justify-content: center;
      color: var(--text-tertiary); font-size: 0.8rem;
    }
    .waitlist-form { display: flex; gap: 0.5rem; max-width: 400px; width: 100%; }
    .waitlist-form input {
      flex: 1; padding: 0.6rem 0.85rem; border: 1px solid var(--border); border-radius: 6px;
      font-size: 0.85rem; font-family: var(--font-body); outline: none; background: white;
    }
    .waitlist-form input:focus { border-color: var(--accent); }
    .waitlist-form button {
      padding: 0.6rem 1.25rem; border: none; border-radius: 6px; background: var(--accent);
      color: white; font-size: 0.85rem; font-weight: 600; font-family: var(--font-body);
      cursor: pointer; white-space: nowrap;
    }
    .waitlist-form button:hover { background: var(--accent-hover); }
    .waitlist-form button:disabled { opacity: 0.6; cursor: not-allowed; }
    .waitlist-msg { font-size: 0.8rem; margin-top: 0.5rem; min-height: 1.2em; }
    .waitlist-msg.success { color: var(--green); }
    .waitlist-msg.error { color: var(--red); }
  </style>
  <div class="landing">
    <h1>Know what you know.</h1>
    <p class="subtitle">Entendi is a comprehension accountability layer for AI-assisted work. It watches how you learn with AI and makes sure you actually understand what you're building.</p>
    <ul class="bullets">
      <li>Observes concepts as you work with AI tools</li>
      <li>Probes your understanding with Socratic questions</li>
      <li>Builds a Bayesian knowledge graph of what you actually know</li>
    </ul>
    <div class="demo-placeholder">demo gif coming soon</div>
    <form class="waitlist-form" id="waitlist-form">
      <input type="email" placeholder="you@example.com" required id="waitlist-email"/>
      <button type="submit">Join the waitlist</button>
    </form>
    <div class="waitlist-msg" id="waitlist-msg"></div>
  </div>
  <script>
    document.getElementById('waitlist-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      const msg = document.getElementById('waitlist-msg');
      const email = document.getElementById('waitlist-email').value;
      btn.disabled = true;
      msg.textContent = '';
      msg.className = 'waitlist-msg';
      try {
        const res = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          msg.textContent = "You're on the list. We'll be in touch.";
          msg.className = 'waitlist-msg success';
          document.getElementById('waitlist-email').value = '';
        } else if (res.status === 409) {
          msg.textContent = "You're already on the list!";
          msg.className = 'waitlist-msg success';
        } else {
          const body = await res.json();
          msg.textContent = body.error || 'Something went wrong.';
          msg.className = 'waitlist-msg error';
        }
      } catch {
        msg.textContent = 'Network error. Try again.';
        msg.className = 'waitlist-msg error';
      }
      btn.disabled = false;
    });
  </script>`);
}

dashboardRoutes.get('/', (c) => {
  const user = c.get('user');

  if (!user) {
    return c.html(getLandingHTML());
  }

  const etag = `"${manifestHash}"`;
  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304);
  }
  c.header('Cache-Control', 'public, max-age=300');
  c.header('ETag', etag);
  return c.html(getShellHTML());
});

dashboardRoutes.get('/press', async (c) => {
  const db = c.get('db');
  const rows = await db.select().from(pressMentions).orderBy(desc(pressMentions.createdAt));

  let content: string;
  if (rows.length === 0) {
    const days = daysSinceLaunch();
    content = `
      <style>
        .press-empty { margin-top: 8rem; text-align: center; }
        .press-empty h2 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; }
        .press-empty p { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6; max-width: 400px; margin: 0 auto; }
      </style>
      <div class="press-empty">
        <h2>Press</h2>
        <p>We've been live for ${days} day${days !== 1 ? 's' : ''}. We're sure the press will come.</p>
      </div>`;
  } else {
    const items = rows.map(r => `
      <li class="press-item">
        <a href="${r.url}" target="_blank" rel="noopener">${r.title}</a>
        <span class="press-meta">${r.source}${r.publishedAt ? ` \u00b7 ${r.publishedAt}` : ''}</span>
      </li>`).join('');
    content = `
      <style>
        .press-page { margin-top: 4rem; }
        .press-page h2 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; }
        .press-list { list-style: none; }
        .press-item { padding: 0.75rem 0; border-bottom: 1px solid var(--border); }
        .press-item a { color: var(--text); text-decoration: none; font-weight: 500; font-size: 0.9rem; }
        .press-item a:hover { color: var(--accent); }
        .press-meta { display: block; color: var(--text-tertiary); font-size: 0.8rem; margin-top: 0.25rem; }
      </style>
      <div class="press-page">
        <h2>Press</h2>
        <ul class="press-list">${items}</ul>
      </div>`;
  }

  return c.html(publicShell('Press \u2014 Entendi', 'press', content));
});

dashboardRoutes.get('/link', (c) => {
  const code = c.req.query('code') || '';
  const safeCode = code.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  const linkJsHref = manifest['link.js'] || '/assets/link.js';
  c.header('Cache-Control', 'public, max-age=300');
  return c.html(getLinkShellHTML(safeCode, linkJsHref));
});
