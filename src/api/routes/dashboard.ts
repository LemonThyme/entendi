import { createHash } from 'crypto';
import { desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { manifest } from '../../dashboard/manifest.js';
import { pressMentions } from '../db/schema.js';
import type { Env } from '../index.js';
import { daysSinceLaunch, type PageMeta, publicShell } from './public-html.js';

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
      <div id="health-banner" class="health-banner" style="display:none"></div>
      <div class="header">
        <h1>entend<svg class="logo-mark" viewBox="0 0 26 75" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M 21 11 C 21 2 12 2 12 11 L 12 55" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" fill="none"/><circle cx="12" cy="69" r="5" fill="currentColor"/></svg></h1>
        <div class="header-meta" id="header-meta"></div>
      </div>
      <div id="user-bar"></div>
      <nav aria-label="Skip to content"><a href="#tab-overview" class="skip-link">Skip to content</a></nav>
      <div class="tabs" id="tabs" role="tablist" aria-label="Dashboard sections">
        <button class="tab-btn active" data-tab="overview" role="tab" aria-selected="true" aria-controls="tab-overview" id="tabBtn-overview" tabindex="0">Overview</button>
        <button class="tab-btn" data-tab="analytics" role="tab" aria-selected="false" aria-controls="tab-analytics" id="tabBtn-analytics" tabindex="-1">Analytics</button>
        <button class="tab-btn" data-tab="concepts" role="tab" aria-selected="false" aria-controls="tab-concepts" id="tabBtn-concepts" tabindex="-1">Concepts</button>
        <button class="tab-btn" data-tab="integrity" role="tab" aria-selected="false" aria-controls="tab-integrity" id="tabBtn-integrity" tabindex="-1">Integrity</button>
        <button class="tab-btn" data-tab="organization" role="tab" aria-selected="false" aria-controls="tab-organization" id="tabBtn-organization" tabindex="-1">Organization</button>
        <button class="tab-btn" data-tab="settings" role="tab" aria-selected="false" aria-controls="tab-settings" id="tabBtn-settings" tabindex="-1">Settings</button>
      </div>

      <div class="tab-content active" id="tab-overview" role="tabpanel" aria-labelledby="tabBtn-overview" tabindex="0">
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

      <div class="tab-content" id="tab-analytics" role="tabpanel" aria-labelledby="tabBtn-analytics" tabindex="0">
        <div class="section">
          <div class="section-header">
            <div class="section-title">Activity</div>
          </div>
          <div class="chart-panel" id="analytics-heatmap" style="height:180px;" role="img" aria-label="Activity heatmap showing assessment frequency by day over the past year"></div>
        </div>
        <div class="section">
          <div class="section-header">
            <div class="section-title">Learning Velocity</div>
            <div class="velocity-toggle" id="velocity-toggle"></div>
          </div>
          <div class="chart-panel" id="analytics-velocity" style="height:300px;" role="img" aria-label="Learning velocity chart showing cumulative mastery gain over time"></div>
        </div>
        <div class="section">
          <div class="section-header">
            <div class="section-title">Domain Strengths</div>
          </div>
          <div class="chart-panel" id="analytics-radar" style="height:350px;" role="img" aria-label="Radar chart comparing mastery levels across knowledge domains"></div>
        </div>
        <div class="section">
          <div class="section-header">
            <div class="section-title">Review Needed</div>
            <div class="section-subtitle">Concepts predicted to decay</div>
          </div>
          <div class="scroll-container" id="analytics-retention" style="max-height:300px;overflow-y:auto;"></div>
        </div>
      </div>

      <div class="tab-content" id="tab-concepts" role="tabpanel" aria-labelledby="tabBtn-concepts" tabindex="0">
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

      <div class="tab-content" id="tab-integrity" role="tabpanel" aria-labelledby="tabBtn-integrity" tabindex="0">
        <div class="section">
          <div class="section-header">
            <div class="section-title">Integrity Trend</div>
          </div>
          <div class="chart-panel" id="integrity-trend" style="height:300px;" role="img" aria-label="Integrity trend chart showing response integrity scores over time"></div>
        </div>
        <div class="section">
          <div class="section-header">
            <div class="section-title">Flagged Responses</div>
          </div>
          <div id="integrity-dismissals"></div>
        </div>
      </div>

      <div class="tab-content" id="tab-organization" role="tabpanel" aria-labelledby="tabBtn-organization" tabindex="0">
        <div id="org-area"></div>
      </div>

      <div class="tab-content" id="tab-settings" role="tabpanel" aria-labelledby="tabBtn-settings" tabindex="0">
        <div id="settings-area"></div>
      </div>
    </div>
  </div>

  <!-- Social login button templates (static SVG, hidden, cloned by JS) -->
  <template id="tpl-github-btn">
    <button class="btn-social" data-provider="github">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
      Sign in with GitHub
    </button>
  </template>
  <template id="tpl-google-btn">
    <button class="btn-social" data-provider="google">
      <svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
      Sign in with Google
    </button>
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

const landingMeta: PageMeta = {
  description: 'An open-source Claude Code plugin that watches what you build with AI and checks that you understand it.',
  ogTitle: 'Entendi',
  ogDescription: 'An open-source Claude Code plugin that watches what you build with AI and checks that you understand it.',
  ogUrl: 'https://entendi.dev',
  ogType: 'website',
  twitterCard: 'summary',
};

function getLandingHTML(): string {
  return publicShell('Entendi', 'home', `
  <style>
    .hero { text-align: center; padding-top: 4rem; padding-bottom: 3rem; }
    .hero h1 { font-family: var(--font-display); font-size: 2.25rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; max-width: 600px; margin: 0 auto 1rem; }
    .hero .subtitle { color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; max-width: 480px; margin: 0 auto 2rem; }
    .install-cta { display: flex; align-items: center; max-width: 480px; margin: 0 auto 0.75rem; background: var(--accent); border-radius: 8px; overflow: hidden; }
    .install-cta code { flex: 1; padding: 0.7rem 1rem; font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace; font-size: 0.8rem; color: white; user-select: all; white-space: nowrap; }
    .install-cta .copy-btn { padding: 0.7rem 0.85rem; background: none; border: none; border-left: 1px solid rgba(255,255,255,0.2); color: white; cursor: pointer; display: flex; align-items: center; }
    .install-cta .copy-btn:hover { background: rgba(255,255,255,0.1); }
    .install-cta .copy-btn svg { width: 16px; height: 16px; }
    .cta-note { color: var(--text-tertiary); font-size: 0.8rem; margin-bottom: 3rem; text-align: center; }
    .cta-note a { color: var(--accent); text-decoration: none; }
    .cta-note a:hover { text-decoration: underline; }
    .demo-area { max-width: 640px; margin: 0 auto 4rem; background: #1a1a2e; border-radius: 8px; padding: 3rem 2rem; text-align: center; }
    .demo-area p { color: rgba(255,255,255,0.5); font-size: 0.85rem; }
    .audience-section { margin-bottom: 4rem; }
    .audience-block { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
    .audience-block h3 { font-family: var(--font-display); font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
    .audience-block p { color: var(--text-secondary); font-size: 0.875rem; line-height: 1.7; }
    .how-section { margin-bottom: 4rem; }
    .how-section h2 { font-family: var(--font-display); font-size: 1.35rem; font-weight: 600; margin-bottom: 1.25rem; }
    .how-steps { list-style: none; counter-reset: steps; }
    .how-steps li { counter-increment: steps; color: var(--text-secondary); font-size: 0.875rem; line-height: 1.7; padding: 0.4rem 0; padding-left: 2rem; position: relative; }
    .how-steps li::before { content: counter(steps) '.'; position: absolute; left: 0; color: var(--accent); font-weight: 600; }
    .bottom-cta { text-align: center; padding-bottom: 4rem; }
    .bottom-cta p { color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.75rem; line-height: 1.6; }
  </style>
  <div class="hero">
    <h1>Actually understand what your AI writes.</h1>
    <p class="subtitle">An open-source Claude Code plugin. It watches what you build with AI and checks that you get it.</p>
    <div class="install-cta">
      <code>git clone https://github.com/LemonThyme/entendi && cd entendi && ./setup.sh</code>
      <button class="copy-btn" data-text="git clone https://github.com/LemonThyme/entendi && cd entendi && ./setup.sh" aria-label="Copy to clipboard">
        <svg class="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        <svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M20 6L9 17l-5-5"/></svg>
      </button>
    </div>
    <p class="cta-note">Free and <a href="https://github.com/LemonThyme/entendi">open source</a>. Requires Node 22+ and Claude Code.</p>
  </div>
  <div class="demo-area">
    <p>Terminal recording coming soon</p>
  </div>
  <div class="audience-section">
    <div class="audience-block">
      <h3>You</h3>
      <p>You've accepted a hundred AI suggestions today. How many could you explain to someone? Entendi asks you about the concepts you're working with. Not every time. Just often enough that you notice what you actually know vs what you're trusting the machine on.</p>
    </div>
    <div class="audience-block">
      <h3>Your team</h3>
      <p>When someone on your team ships a feature they built with AI, do they understand the code well enough to debug it at 2am when something breaks? Entendi tracks what each engineer understands across the codebase. You see the gaps before they hit production.</p>
    </div>
    <div class="audience-block">
      <h3>Your students</h3>
      <p>Students are submitting AI-generated code. You know it. They know it. Banning AI isn't realistic and doesn't teach anything. Entendi sits inside the coding environment and asks questions as they work. Not a plagiarism detector. A tutor.</p>
    </div>
  </div>
  <div class="how-section">
    <h2>How it works</h2>
    <ol class="how-steps">
      <li>You code with Claude like normal</li>
      <li>Entendi watches the technical concepts that come up</li>
      <li>When something's worth checking, it asks you a question</li>
      <li>Your answers build a knowledge profile over time</li>
    </ol>
  </div>
  <div class="bottom-cta">
    <div class="install-cta">
      <code>git clone https://github.com/LemonThyme/entendi && cd entendi && ./setup.sh</code>
      <button class="copy-btn" data-text="git clone https://github.com/LemonThyme/entendi && cd entendi && ./setup.sh" aria-label="Copy to clipboard">
        <svg class="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        <svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M20 6L9 17l-5-5"/></svg>
      </button>
    </div>
    <p><a href="https://github.com/LemonThyme/entendi" style="color: var(--accent); text-decoration: none;">Open source on GitHub</a>. Free for individuals. Team and university plans coming.</p>
  </div>
  <script>
    document.querySelectorAll('.copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var text = btn.getAttribute('data-text');
        navigator.clipboard.writeText(text).then(function() {
          btn.querySelector('.icon-copy').style.display = 'none';
          btn.querySelector('.icon-check').style.display = '';
          setTimeout(function() {
            btn.querySelector('.icon-copy').style.display = '';
            btn.querySelector('.icon-check').style.display = 'none';
          }, 1500);
        });
      });
    });
  </script>`, landingMeta);
}

function getPrivacyHTML(): string {
  return publicShell('Privacy Policy | Entendi', 'privacy', `
  <style>
    .legal-page { margin-top: 4rem; margin-bottom: 4rem; }
    .legal-page h2 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; }
    .legal-page h3 { font-size: 0.95rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.5rem; }
    .legal-page p, .legal-page li { color: var(--text-secondary); font-size: 0.85rem; line-height: 1.7; }
    .legal-page p { margin-bottom: 0.75rem; }
    .legal-page ul { padding-left: 1.25rem; margin-bottom: 0.75rem; }
    .legal-page li { margin-bottom: 0.25rem; }
    .legal-page a { color: var(--accent); text-decoration: none; }
    .legal-page a:hover { text-decoration: underline; }
    .legal-date { color: var(--text-tertiary); font-size: 0.8rem; margin-bottom: 1.5rem; }
  </style>
  <div class="legal-page">
    <h2>Privacy Policy</h2>
    <p class="legal-date">Effective: February 28, 2026</p>

    <h3>What Entendi Does</h3>
    <p>Entendi is a comprehension accountability layer for AI-assisted work. It observes concepts you encounter while working with AI tools and probes your understanding through Socratic questioning.</p>

    <h3>Data We Collect</h3>
    <ul>
      <li><strong>Account information</strong>: email address and display name when you sign up</li>
      <li><strong>IP address</strong>: recorded in session logs for security and abuse prevention</li>
      <li><strong>Probe responses</strong>: your text answers to comprehension probes</li>
      <li><strong>Behavioral biometrics</strong>: response patterns (word count, typing speed, vocabulary complexity) and anomaly scores used to detect integrity issues</li>
      <li><strong>Session cookies</strong>: used for authentication; expire after 7 days</li>
      <li><strong>Concept and mastery data</strong>: which concepts you've encountered and your assessed understanding</li>
    </ul>

    <h3>How We Use Your Data</h3>
    <p>Your data is used exclusively to provide the Entendi service: tracking comprehension, generating probes, computing mastery scores, and detecting anomalies. We do not sell your data or use it for advertising.</p>

    <h3>Data Sharing</h3>
    <p>If you belong to an organization on Entendi, your mastery data and assessment history may be visible to organization administrators. We do not share data with third parties except as required by law.</p>

    <h3>Data Retention</h3>
    <p>Your data is retained as long as your account is active. You may delete your account and all associated data at any time via the account deletion endpoint (DELETE /api/me) or by contacting us.</p>

    <h3>Security</h3>
    <p>Data is stored in a PostgreSQL database hosted on Neon with encryption at rest and in transit. Probe tokens are HMAC-signed and single-use.</p>

    <h3>Contact</h3>
    <p>For privacy inquiries, use the <a href="/contact">contact form</a>.</p>
  </div>`, {
    description: 'How Entendi handles your data.',
    ogTitle: 'Privacy Policy | Entendi',
    ogUrl: 'https://entendi.dev/privacy',
    ogType: 'website',
    twitterCard: 'summary',
  });
}

function getTermsHTML(): string {
  return publicShell('Terms of Service | Entendi', 'terms', `
  <style>
    .legal-page { margin-top: 4rem; margin-bottom: 4rem; }
    .legal-page h2 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; }
    .legal-page h3 { font-size: 0.95rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.5rem; }
    .legal-page p, .legal-page li { color: var(--text-secondary); font-size: 0.85rem; line-height: 1.7; }
    .legal-page p { margin-bottom: 0.75rem; }
    .legal-page ul { padding-left: 1.25rem; margin-bottom: 0.75rem; }
    .legal-page li { margin-bottom: 0.25rem; }
    .legal-page a { color: var(--accent); text-decoration: none; }
    .legal-page a:hover { text-decoration: underline; }
    .legal-date { color: var(--text-tertiary); font-size: 0.8rem; margin-bottom: 1.5rem; }
  </style>
  <div class="legal-page">
    <h2>Terms of Service</h2>
    <p class="legal-date">Effective: February 28, 2026</p>

    <h3>Acceptance</h3>
    <p>By using Entendi, you agree to these terms. If you do not agree, do not use the service.</p>

    <h3>The Service</h3>
    <p>Entendi provides comprehension accountability for AI-assisted work. It observes concepts in your AI interactions, probes your understanding, and maintains a knowledge graph of your assessed mastery.</p>

    <h3>Your Account</h3>
    <p>You are responsible for maintaining the security of your account credentials. You must provide accurate information when creating an account.</p>

    <h3>Acceptable Use</h3>
    <ul>
      <li>Do not attempt to manipulate or game the comprehension assessment system</li>
      <li>Do not use automated tools to generate probe responses</li>
      <li>Do not share account credentials with others</li>
      <li>Do not attempt to access other users' data</li>
    </ul>

    <h3>Intellectual Property</h3>
    <p>Your probe responses and learning data belong to you. Entendi's software, design, and assessment methodology are owned by Entendi.</p>

    <h3>Account Deletion</h3>
    <p>You may delete your account at any time. Deletion removes all your data including mastery scores, assessment history, probe responses, and behavioral profiles. This action is irreversible.</p>

    <h3>Limitation of Liability</h3>
    <p>Entendi is provided "as is" without warranty. We are not liable for any damages arising from your use of the service, including but not limited to inaccurate mastery assessments.</p>

    <h3>Changes to Terms</h3>
    <p>We may update these terms. Continued use after changes constitutes acceptance. Material changes will be communicated via the email associated with your account.</p>

    <h3>Contact</h3>
    <p>Questions about these terms? Use the <a href="/contact">contact form</a>.</p>
  </div>`, {
    description: 'Terms of service for using Entendi.',
    ogTitle: 'Terms of Service | Entendi',
    ogUrl: 'https://entendi.dev/terms',
    ogType: 'website',
    twitterCard: 'summary',
  });
}

dashboardRoutes.get('/privacy', (c) => {
  return c.html(getPrivacyHTML());
});

dashboardRoutes.get('/terms', (c) => {
  return c.html(getTermsHTML());
});

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

  return c.html(publicShell('Press | Entendi', 'press', content, {
    description: 'Press coverage and media mentions of Entendi.',
    ogTitle: 'Press | Entendi',
    ogUrl: 'https://entendi.dev/press',
    ogType: 'website',
    twitterCard: 'summary',
  }));
});

dashboardRoutes.get('/contact', (c) => {
  const content = `
    <style>
      .contact-page { margin-top: 4rem; max-width: 480px; }
      .contact-page h2 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; }
      .contact-form label { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.25rem; margin-top: 1rem; }
      .contact-form label:first-child { margin-top: 0; }
      .contact-form input, .contact-form textarea {
        width: 100%; padding: 0.6rem 0.85rem; border: 1px solid var(--border); border-radius: 6px;
        font-size: 0.85rem; font-family: var(--font-body); outline: none; background: white;
      }
      .contact-form input:focus, .contact-form textarea:focus { border-color: var(--accent); }
      .contact-form textarea { min-height: 120px; resize: vertical; }
      .contact-form button {
        margin-top: 1.25rem; padding: 0.6rem 1.5rem; border: none; border-radius: 6px;
        background: var(--accent); color: white; font-size: 0.85rem; font-weight: 600;
        font-family: var(--font-body); cursor: pointer;
      }
      .contact-form button:hover { background: var(--accent-hover); }
      .contact-form button:disabled { opacity: 0.6; cursor: not-allowed; }
      .contact-msg { font-size: 0.8rem; margin-top: 0.5rem; min-height: 1.2em; }
      .contact-msg.success { color: var(--green); }
      .contact-msg.error { color: var(--red); }
    </style>
    <div class="contact-page">
      <h2>Contact</h2>
      <form class="contact-form" id="contact-form">
        <label for="c-name">Name</label>
        <input type="text" id="c-name" required/>
        <label for="c-email">Email</label>
        <input type="email" id="c-email" required/>
        <label for="c-message">Message</label>
        <textarea id="c-message" required></textarea>
        <button type="submit">Send</button>
      </form>
      <div class="contact-msg" id="contact-msg"></div>
    </div>
    <script>
      document.getElementById('contact-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const msg = document.getElementById('contact-msg');
        btn.disabled = true;
        msg.textContent = '';
        msg.className = 'contact-msg';
        try {
          const res = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: document.getElementById('c-name').value,
              email: document.getElementById('c-email').value,
              message: document.getElementById('c-message').value,
            }),
          });
          if (res.ok) {
            msg.textContent = 'Message sent. Thanks!';
            msg.className = 'contact-msg success';
            e.target.reset();
          } else {
            const body = await res.json();
            msg.textContent = body.error || 'Something went wrong.';
            msg.className = 'contact-msg error';
          }
        } catch {
          msg.textContent = 'Network error. Try again.';
          msg.className = 'contact-msg error';
        }
        btn.disabled = false;
      });
    </script>`;

  return c.html(publicShell('Contact | Entendi', 'contact', content, {
    description: 'Get in touch with the Entendi team.',
    ogTitle: 'Contact | Entendi',
    ogUrl: 'https://entendi.dev/contact',
    ogType: 'website',
    twitterCard: 'summary',
  }));
});

dashboardRoutes.get('/login', (c) => {
  const user = c.get('user');
  if (user) return c.redirect('/');
  return c.html(getShellHTML());
});

dashboardRoutes.get('/link', (c) => {
  const code = c.req.query('code') || '';
  const safeCode = code.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  const linkJsHref = manifest['link.js'] || '/assets/link.js';
  c.header('Cache-Control', 'public, max-age=300');
  return c.html(getLinkShellHTML(safeCode, linkJsHref));
});
