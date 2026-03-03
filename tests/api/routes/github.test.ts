import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/api/index.js';

function createDbMock(resultQueues: { select?: any[][]; insert?: any[][]; update?: any[][]; delete?: any[][] } = {}) {
  const selectQueue = [...(resultQueues.select ?? [])];
  const insertQueue = [...(resultQueues.insert ?? [])];
  const updateQueue = [...(resultQueues.update ?? [])];
  const deleteQueue = [...(resultQueues.delete ?? [])];

  const makeLink = (queue: any[][]): any => {
    const link: any = {
      from: vi.fn(() => makeLink(queue)),
      where: vi.fn(() => makeLink(queue)),
      set: vi.fn(() => makeLink(queue)),
      values: vi.fn(() => makeLink(queue)),
      returning: vi.fn(() => makeLink(queue)),
      limit: vi.fn(() => Promise.resolve(queue.length > 0 ? queue.shift() : [])),
      // biome-ignore lint/suspicious/noThenProperty: simulates Drizzle thenable query
      then(resolve: any, reject?: any) {
        return Promise.resolve(queue.length > 0 ? queue.shift() : []).then(resolve, reject);
      },
    };
    return link;
  };

  return {
    select: vi.fn(() => makeLink(selectQueue)),
    insert: vi.fn(() => makeLink(insertQueue)),
    update: vi.fn(() => makeLink(updateQueue)),
    delete: vi.fn(() => makeLink(deleteQueue)),
  };
}

function createApp(db: any, opts: { userId?: string; orgId?: string | null } = {}) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('db', db as any);
    c.set('auth', {} as any);
    c.set('user', { id: opts.userId ?? 'user-1', name: 'Test', email: 'test@test.com' });
    c.set('session', {
      id: 'sess-1',
      userId: opts.userId ?? 'user-1',
      activeOrganizationId: 'orgId' in opts ? opts.orgId : 'org-1',
    });
    await next();
  });
  return app;
}

async function mountGithub(app: Hono<Env>) {
  const { githubRoutes } = await import('../../../src/api/routes/github.js');
  app.route('/github', githubRoutes);
  return app;
}

describe('GitHub Routes', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.GITHUB_APP_URL = 'https://github.com/apps/entendi';
    process.env.GITHUB_APP_ID = 'test-app-id';
    process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // --- GET /install-url ---
  describe('GET /install-url', () => {
    it('returns install URL from GITHUB_APP_URL', async () => {
      const db = createDbMock();
      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/install-url');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.url).toBe('https://github.com/apps/entendi/installations/new');
    });

    it('returns install URL from GITHUB_APP_ID when no GITHUB_APP_URL', async () => {
      delete process.env.GITHUB_APP_URL;
      process.env.GITHUB_APP_ID = 'test-id';
      const db = createDbMock();
      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/install-url');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.url).toContain('installations/new');
    });

    it('returns 503 when GitHub App not configured', async () => {
      delete process.env.GITHUB_APP_URL;
      delete process.env.GITHUB_APP_ID;
      const db = createDbMock();
      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/install-url');
      expect(res.status).toBe(503);
    });

    it('returns 401 for unauthenticated user', async () => {
      const db = createDbMock();
      const app = new Hono<Env>();
      app.use('*', async (c, next) => {
        c.set('db', db as any);
        c.set('auth', {} as any);
        c.set('user', null);
        c.set('session', null);
        await next();
      });
      await mountGithub(app);

      const res = await app.request('/github/install-url');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /callback ---
  describe('GET /callback', () => {
    it('returns 400 when installation_id is missing', async () => {
      const db = createDbMock();
      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/callback');
      expect(res.status).toBe(400);
    });

    it('creates installation on install callback (201)', async () => {
      const installation = {
        id: 'inst-123',
        orgId: 'org-1',
        githubOrgLogin: '',
        installedBy: 'user-1',
        accessToken: null,
        tokenExpiresAt: null,
        createdAt: new Date(),
      };

      const db = createDbMock({
        select: [
          [{ role: 'member' }], // requireOrgMembership
          [],                    // check existing installation
          [installation],        // fetch created
        ],
        insert: [[]],
      });

      // No GITHUB_PRIVATE_KEY so token fetch is skipped
      delete process.env.GITHUB_PRIVATE_KEY;

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/callback?installation_id=inst-123&setup_action=install');
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.id).toBe('inst-123');
    });

    it('returns existing installation if already exists', async () => {
      const existing = {
        id: 'inst-123',
        orgId: 'org-1',
        githubOrgLogin: 'myorg',
        installedBy: 'user-1',
        accessToken: 'tok',
        tokenExpiresAt: null,
        createdAt: new Date(),
      };

      const db = createDbMock({
        select: [
          [{ role: 'member' }], // requireOrgMembership
          [existing],            // existing installation found
        ],
      });

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/callback?installation_id=inst-123&setup_action=install');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.id).toBe('inst-123');
    });

    it('returns 400 with no active org', async () => {
      const db = createDbMock();
      const app = createApp(db, { orgId: null });
      await mountGithub(app);

      const res = await app.request('/github/callback?installation_id=inst-123&setup_action=install');
      expect(res.status).toBe(400);
    });
  });

  // --- GET /repos ---
  describe('GET /repos', () => {
    it('returns 404 when no installation exists', async () => {
      const db = createDbMock({
        select: [
          [{ role: 'member' }], // requireOrgMembership
          [],                    // no installations
        ],
      });

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/repos');
      expect(res.status).toBe(404);
    });

    it('returns 400 when installation has no token', async () => {
      const db = createDbMock({
        select: [
          [{ role: 'member' }],
          [{ id: 'inst-1', orgId: 'org-1', accessToken: null, tokenExpiresAt: null }],
        ],
      });

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/repos');
      expect(res.status).toBe(400);
    });

    it('returns 401 when installation token is expired', async () => {
      const db = createDbMock({
        select: [
          [{ role: 'member' }],
          [{ id: 'inst-1', orgId: 'org-1', accessToken: 'tok', tokenExpiresAt: new Date('2020-01-01') }],
        ],
      });

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/repos');
      expect(res.status).toBe(401);
    });
  });

  // --- POST /installations/:id/refresh-token ---
  describe('POST /installations/:id/refresh-token', () => {
    it('returns 404 when installation not found', async () => {
      const db = createDbMock({
        select: [
          [{ role: 'member' }], // requireOrgMembership
          [],                    // installation not found
        ],
      });

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/installations/nonexistent/refresh-token', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 503 when GitHub App credentials not configured', async () => {
      delete process.env.GITHUB_APP_ID;
      delete process.env.GITHUB_PRIVATE_KEY;

      const db = createDbMock({
        select: [
          [{ role: 'member' }],
          [{ id: 'inst-1', orgId: 'org-1' }],
        ],
      });

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/installations/inst-1/refresh-token', { method: 'POST' });
      expect(res.status).toBe(503);
    });
  });

  // --- POST /webhook ---
  describe('POST /webhook', () => {
    async function signPayload(payload: string, secret: string): Promise<string> {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
      const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
      return `sha256=${hex}`;
    }

    it('rejects missing signature (401)', async () => {
      const db = createDbMock();
      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
        },
        body: JSON.stringify({ repository: { id: 123 } }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects invalid signature (401)', async () => {
      const db = createDbMock();
      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-Hub-Signature-256': 'sha256=invalid',
        },
        body: JSON.stringify({ repository: { id: 123 } }),
      });
      expect(res.status).toBe(401);
    });

    it('handles push event — sets sync_status to pending_review', async () => {
      const payload = JSON.stringify({ repository: { id: 456 } });
      const signature = await signPayload(payload, 'test-webhook-secret');

      const db = createDbMock({
        select: [[{ id: 'cb-1', githubRepoId: '456' }]], // codebase lookup
        update: [[]],
      });

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-Hub-Signature-256': signature,
        },
        body: payload,
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(db.update).toHaveBeenCalled();
    });

    it('handles push event — no matching codebase (still 200)', async () => {
      const payload = JSON.stringify({ repository: { id: 999 } });
      const signature = await signPayload(payload, 'test-webhook-secret');

      const db = createDbMock({
        select: [[]], // no codebase found
      });

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-Hub-Signature-256': signature,
        },
        body: payload,
      });

      expect(res.status).toBe(200);
    });

    it('handles installation deleted event', async () => {
      const payload = JSON.stringify({ action: 'deleted', installation: { id: 789 } });
      const signature = await signPayload(payload, 'test-webhook-secret');

      const db = createDbMock({
        delete: [[]],
      });

      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'installation',
          'X-Hub-Signature-256': signature,
        },
        body: payload,
      });

      expect(res.status).toBe(200);
      expect(db.delete).toHaveBeenCalled();
    });

    it('returns 200 for unhandled event types', async () => {
      const payload = JSON.stringify({ action: 'completed' });
      const signature = await signPayload(payload, 'test-webhook-secret');

      const db = createDbMock();
      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'check_run',
          'X-Hub-Signature-256': signature,
        },
        body: payload,
      });

      expect(res.status).toBe(200);
    });

    it('returns 503 when webhook secret not configured', async () => {
      delete process.env.GITHUB_WEBHOOK_SECRET;

      const db = createDbMock();
      const app = createApp(db);
      await mountGithub(app);

      const res = await app.request('/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
        },
        body: '{}',
      });
      expect(res.status).toBe(503);
    });
  });
});
