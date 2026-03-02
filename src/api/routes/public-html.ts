const LAUNCH_DATE = new Date('2026-02-27T00:00:00Z');

export function daysSinceLaunch(): number {
  return Math.floor((Date.now() - LAUNCH_DATE.getTime()) / (1000 * 60 * 60 * 24));
}

export type PageId = 'home' | 'press' | 'contact' | 'privacy' | 'terms' | 'status';

export interface PageMeta {
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogUrl?: string;
  ogType?: string;
  twitterCard?: string;
}

function nav(active: PageId): string {
  const base = active === 'status' ? 'https://entendi.dev' : '';
  const link = (href: string, label: string, key: PageId) =>
    `<a href="${base}${href}" class="nav-link${active === key ? ' active' : ''}">${label}</a>`;
  return `<nav class="site-nav">
    ${link('/', 'entendi', 'home')}
    <span class="nav-sep">|</span>
    ${link('/press', 'press', 'press')}
    <span class="nav-sep">|</span>
    ${link('/contact', 'contact', 'contact')}
    <a href="${base}/login" class="nav-link nav-signin">sign in</a>
  </nav>`;
}

function metaTags(meta?: PageMeta): string {
  if (!meta) return '';
  const tags: string[] = [];
  if (meta.description) tags.push(`<meta name="description" content="${meta.description}"/>`);
  if (meta.ogTitle) tags.push(`<meta property="og:title" content="${meta.ogTitle}"/>`);
  if (meta.ogDescription) tags.push(`<meta property="og:description" content="${meta.ogDescription}"/>`);
  if (meta.ogUrl) tags.push(`<meta property="og:url" content="${meta.ogUrl}"/>`);
  if (meta.ogType) tags.push(`<meta property="og:type" content="${meta.ogType}"/>`);
  if (meta.twitterCard) tags.push(`<meta name="twitter:card" content="${meta.twitterCard}"/>`);
  return tags.join('\n  ');
}

export function publicShell(title: string, active: PageId, body: string, meta?: PageMeta): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  ${metaTags(meta)}
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231a1a2e'/%3E%3Cpath d='M 19.5 7 C 19.5 3.5 15.5 3.5 15.5 7 L 15.5 22' stroke='white' stroke-width='3' stroke-linecap='round' fill='none'/%3E%3Ccircle cx='15.5' cy='27' r='2' fill='white'/%3E%3C/svg%3E"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: #F6F4F1; --bg-card: #EDEAE5; --border: #E0DCD6;
      --text: #1F1F1F; --text-secondary: #7A7268; --text-tertiary: #9B9389;
      --accent: #C4704B; --accent-hover: #A85D3D;
      --green: #5B7B5E; --red: #B84233;
      --font-display: 'Source Serif 4', Georgia, 'Times New Roman', serif;
      --font-body: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-body); background: var(--bg); color: var(--text);
      min-height: 100vh; -webkit-font-smoothing: antialiased;
    }
    .site-nav {
      padding: 1.5rem 2rem; font-size: 0.85rem; color: var(--text-secondary);
      display: flex; align-items: center; gap: 0.5rem;
    }
    .nav-link {
      color: var(--text-secondary); text-decoration: none; font-weight: 400;
    }
    .nav-link:hover { color: var(--text); }
    .nav-link.active { color: var(--text); font-weight: 500; }
    .nav-sep { color: var(--border); user-select: none; }
    .nav-signin { margin-left: auto; }
    .page-body {
      max-width: 700px; margin: 0 auto; padding: 0 2rem;
    }
  </style>
</head>
<body>
  ${nav(active)}
  <div class="page-body">
    ${body}
  </div>
</body>
</html>`;
}
