import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { codebases, githubInstallations, member } from '../db/schema.js';
import type { Env } from '../index.js';
import { createInstallationToken, GitHubClient, refreshInstallationToken } from '../lib/github.js';
import { resolveOrgId } from '../lib/resolve-org.js';
import { requireAuth } from '../middleware/auth.js';

export const githubRoutes = new Hono<Env>();

/** Verify user is a member of the active org. Returns orgId or error Response. */
async function requireOrgMembership(c: Context<Env>): Promise<{ orgId: string } | Response> {
  const orgId = await resolveOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const db = c.get('db');
  const user = c.get('user')!;
  const [membership] = await db.select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, user.id), eq(member.organizationId, orgId)))
    .limit(1);

  if (!membership) return c.json({ error: 'Not a member of this organization' }, 403);
  return { orgId };
}

// --- GET /install-url (public GitHub App install URL) ---
githubRoutes.get('/install-url', requireAuth, async (c) => {
  const appUrl = process.env.GITHUB_APP_URL;
  const appId = process.env.GITHUB_APP_ID;

  if (appUrl) {
    return c.json({ url: `${appUrl}/installations/new` });
  }
  if (appId) {
    return c.json({ url: `https://github.com/apps/entendi/installations/new` });
  }

  return c.json({ error: 'GitHub App not configured' }, 503);
});

// --- GET /callback (handle installation callback from GitHub) ---
githubRoutes.get('/callback', requireAuth, async (c) => {
  const installationId = c.req.query('installation_id');
  const setupAction = c.req.query('setup_action');

  if (!installationId) {
    return c.json({ error: 'Missing installation_id' }, 400);
  }

  if (setupAction === 'install' || setupAction === undefined) {
    const orgResult = await requireOrgMembership(c);
    if (orgResult instanceof Response) return orgResult;
    const { orgId } = orgResult;

    const db = c.get('db');
    const user = c.get('user')!;

    // Check if this installation already exists for this org
    const [existing] = await db.select().from(githubInstallations)
      .where(and(
        eq(githubInstallations.id, installationId),
        eq(githubInstallations.orgId, orgId),
      ));

    if (existing) {
      return c.json(existing);
    }

    // Try to get an access token if GitHub App credentials are configured
    let accessToken: string | null = null;
    let tokenExpiresAt: Date | null = null;
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_PRIVATE_KEY;

    if (appId && privateKey) {
      try {
        const tokenResult = await createInstallationToken(installationId, appId, privateKey);
        accessToken = tokenResult.token;
        tokenExpiresAt = new Date(tokenResult.expires_at);
      } catch {
        // Non-fatal: store installation without token, user can refresh later
      }
    }

    const id = installationId;
    await db.insert(githubInstallations).values({
      id,
      orgId,
      githubOrgLogin: '', // Will be populated on first token use
      installedBy: user.id,
      accessToken,
      tokenExpiresAt,
    });

    const [created] = await db.select().from(githubInstallations)
      .where(eq(githubInstallations.id, id));
    return c.json(created, 201);
  }

  return c.json({ ok: true, setupAction });
});

// --- GET /repos (list repos accessible via installation) ---
githubRoutes.get('/repos', requireAuth, async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const db = c.get('db');
  const installations = await db.select().from(githubInstallations)
    .where(eq(githubInstallations.orgId, orgId));

  if (installations.length === 0) {
    return c.json({ error: 'No GitHub installation found for this organization' }, 404);
  }

  const installation = installations[0];
  if (!installation.accessToken) {
    return c.json({ error: 'Installation has no access token. Refresh the token first.' }, 400);
  }

  // Check if token is expired
  if (installation.tokenExpiresAt && new Date(installation.tokenExpiresAt) < new Date()) {
    return c.json({ error: 'Installation token expired. Refresh the token first.' }, 401);
  }

  const client = new GitHubClient(installation.accessToken);
  const repos = await client.listInstallationRepos();

  return c.json(repos.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    htmlUrl: r.html_url,
    description: r.description,
    defaultBranch: r.default_branch,
  })));
});

// --- POST /installations/:id/refresh-token ---
githubRoutes.post('/installations/:id/refresh-token', requireAuth, async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const installationId = c.req.param('id');
  const db = c.get('db');

  const [installation] = await db.select().from(githubInstallations)
    .where(and(
      eq(githubInstallations.id, installationId),
      eq(githubInstallations.orgId, orgId),
    ));

  if (!installation) {
    return c.json({ error: 'Installation not found' }, 404);
  }

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKey) {
    return c.json({ error: 'GitHub App credentials not configured' }, 503);
  }

  const tokenResult = await refreshInstallationToken(installationId, appId, privateKey);

  await db.update(githubInstallations).set({
    accessToken: tokenResult.token,
    tokenExpiresAt: new Date(tokenResult.expires_at),
  }).where(eq(githubInstallations.id, installationId));

  return c.json({
    installationId,
    expiresAt: tokenResult.expires_at,
  });
});

// --- POST /webhook (GitHub webhook handler) ---
githubRoutes.post('/webhook', async (c) => {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return c.json({ error: 'Webhook not configured' }, 503);
  }

  // Verify HMAC-SHA256 signature
  const signature = c.req.header('X-Hub-Signature-256');
  if (!signature) {
    return c.json({ error: 'Missing signature' }, 401);
  }

  const body = await c.req.text();
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const hexSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  const expected = `sha256=${hexSig}`;

  // Constant-time comparison
  if (signature.length !== expected.length) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const enc2 = new TextEncoder();
  const sigA = enc2.encode(signature);
  const sigB = enc2.encode(expected);
  let diff = 0;
  for (let i = 0; i < sigA.length; i++) {
    diff |= sigA[i] ^ sigB[i];
  }
  if (diff !== 0) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const event = c.req.header('X-GitHub-Event');
  const payload = JSON.parse(body);
  const db = c.get('db');

  if (event === 'push') {
    // Look up codebase by repo ID and set sync_status to pending_review
    const repoId = String(payload.repository?.id);
    if (repoId) {
      const [codebase] = await db.select().from(codebases)
        .where(eq(codebases.githubRepoId, repoId));
      if (codebase) {
        await db.update(codebases).set({ syncStatus: 'pending_review' })
          .where(eq(codebases.id, codebase.id));
      }
    }
  } else if (event === 'installation') {
    const action = payload.action;
    if (action === 'deleted') {
      const installationId = String(payload.installation?.id);
      if (installationId) {
        await db.delete(githubInstallations)
          .where(eq(githubInstallations.id, installationId));
      }
    }
    // 'created' is handled via the callback flow
  }

  return c.json({ ok: true });
});
