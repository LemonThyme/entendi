# Codebases & Syllabi Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add codebases (GitHub-connected concept maps) and syllabi (document-based concept maps) with custom org roles, replacing the courses feature.

**Architecture:** New DB tables for codebases, syllabi, roles, and GitHub installations. CRUD API routes following existing Hono/Zod patterns. Dashboard tabs for management. Plugin sends `repoUrl` to scope probes.

**Tech Stack:** Drizzle ORM, Hono, Zod, GitHub App API, Cloudflare Workers

---

## Phase 1: Schema & Custom Roles (foundation)

### Task 1: Add schema tables for custom roles

**Files:**
- Modify: `src/api/db/schema.ts`

**Step 1: Add org_roles and org_role_permissions tables**

```typescript
// After the invitation table (~line 95)

export const orgRoles = pgTable('org_roles', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_org_roles_org').on(table.orgId),
  unique('uq_org_roles_name').on(table.orgId, table.name),
]);

export const orgRolePermissions = pgTable('org_role_permissions', {
  roleId: text('role_id').notNull().references(() => orgRoles.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull(),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permission] }),
]);
```

**Step 2: Add roleId to member table**

```typescript
// In the member table definition, add:
roleId: text('role_id').references(() => orgRoles.id, { onDelete: 'set null' }),
```

**Step 3: Generate migration**

Run: `npx drizzle-kit generate`

**Step 4: Commit**

```bash
git add src/api/db/schema.ts drizzle/
git commit -m "feat(schema): add org_roles and org_role_permissions tables"
```

---

### Task 2: Add schema tables for codebases

**Files:**
- Modify: `src/api/db/schema.ts`

**Step 1: Add github_installations table**

```typescript
export const githubInstallations = pgTable('github_installations', {
  id: text('id').primaryKey(), // GitHub's installation ID
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  githubOrgLogin: text('github_org_login').notNull(),
  installedBy: text('installed_by').notNull().references(() => user.id),
  accessToken: text('access_token'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_github_installations_org').on(table.orgId),
]);
```

**Step 2: Add codebases, codebase_concepts, codebase_enrollments tables**

```typescript
export const codebases = pgTable('codebases', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  githubRepoOwner: text('github_repo_owner'),
  githubRepoName: text('github_repo_name'),
  githubRepoId: text('github_repo_id'),
  githubInstallationId: text('github_installation_id').references(() => githubInstallations.id),
  lastSyncCommit: text('last_sync_commit'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  syncStatus: text('sync_status').notNull().default('idle'),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_codebases_org').on(table.orgId),
]);

export const codebaseConcepts = pgTable('codebase_concepts', {
  codebaseId: text('codebase_id').notNull().references(() => codebases.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  importance: text('importance').notNull().default('supporting'),
  learningObjective: text('learning_objective'),
  autoExtracted: boolean('auto_extracted').notNull().default(true),
  curatedBy: text('curated_by').references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.codebaseId, table.conceptId] }),
]);

export const codebaseEnrollments = pgTable('codebase_enrollments', {
  codebaseId: text('codebase_id').notNull().references(() => codebases.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.codebaseId, table.userId] }),
]);
```

**Step 3: Generate migration**

Run: `npx drizzle-kit generate`

**Step 4: Commit**

```bash
git add src/api/db/schema.ts drizzle/
git commit -m "feat(schema): add codebases, codebase_concepts, codebase_enrollments, github_installations"
```

---

### Task 3: Add schema tables for syllabi

**Files:**
- Modify: `src/api/db/schema.ts`

**Step 1: Add syllabi, syllabus_sources, syllabus_concepts, syllabus_enrollments tables**

```typescript
export const syllabi = pgTable('syllabi', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_syllabi_org').on(table.orgId),
]);

export const syllabusSources = pgTable('syllabus_sources', {
  id: text('id').primaryKey(),
  syllabusId: text('syllabus_id').notNull().references(() => syllabi.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(), // pdf | url | markdown | manual
  sourceUrl: text('source_url'),
  fileName: text('file_name'),
  extractionStatus: text('extraction_status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_syllabus_sources_syllabus').on(table.syllabusId),
]);

export const syllabusConcepts = pgTable('syllabus_concepts', {
  syllabusId: text('syllabus_id').notNull().references(() => syllabi.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  importance: text('importance').notNull().default('supporting'),
  learningObjective: text('learning_objective'),
  autoExtracted: boolean('auto_extracted').notNull().default(true),
  curatedBy: text('curated_by').references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.syllabusId, table.conceptId] }),
]);

export const syllabusEnrollments = pgTable('syllabus_enrollments', {
  syllabusId: text('syllabus_id').notNull().references(() => syllabi.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.syllabusId, table.userId] }),
]);
```

**Step 2: Generate migration**

Run: `npx drizzle-kit generate`

**Step 3: Commit**

```bash
git add src/api/db/schema.ts drizzle/
git commit -m "feat(schema): add syllabi, syllabus_sources, syllabus_concepts, syllabus_enrollments"
```

---

### Task 4: Write unit tests for roles permission middleware

**Files:**
- Create: `src/api/middleware/permissions.ts`
- Create: `tests/api/middleware/permissions.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/api/middleware/permissions.test.ts
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

describe('requirePermission middleware', () => {
  function createDbMock(memberResult: any[], permResult: any[]) {
    let queue = [memberResult, permResult];
    const makeLink = (): any => {
      let resolved = false;
      const link: any = {
        from: vi.fn(() => makeLink()),
        where: vi.fn(() => makeLink()),
        innerJoin: vi.fn(() => makeLink()),
        limit: vi.fn(() => Promise.resolve(queue.length > 0 ? queue.shift() : [])),
        then(resolve: any, reject?: any) {
          if (!resolved) { resolved = true; return Promise.resolve(queue.length > 0 ? queue.shift() : []).then(resolve, reject); }
          return Promise.resolve(undefined).then(resolve, reject);
        },
      };
      return link;
    };
    return { select: vi.fn(() => makeLink()) };
  }

  function createApp(db: any, opts: { userId?: string; orgId?: string | null } = {}) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', db as any);
      c.set('auth', {} as any);
      c.set('user', { id: opts.userId ?? 'user-1', name: 'Test', email: 'test@test.com' });
      c.set('session', { id: 'sess-1', userId: opts.userId ?? 'user-1', activeOrganizationId: opts.orgId ?? 'org-1' });
      await next();
    });
    return app;
  }

  it('allows owner regardless of custom role', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'owner', roleId: null }], // member query
      [] // permissions query (not needed for owner)
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('allows admin regardless of custom role', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'admin', roleId: null }],
      []
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('allows member with matching custom role permission', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'member', roleId: 'role-teacher' }],
      [{ permission: 'codebases.create' }]
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('rejects member without matching permission', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'member', roleId: 'role-viewer' }],
      [{ permission: 'members.view' }] // wrong permission
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('rejects member with no custom role', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock(
      [{ role: 'member', roleId: null }],
      []
    );
    const app = createApp(db);
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('returns 400 if no active org', async () => {
    const { requirePermission } = await import('../../../src/api/middleware/permissions.js');
    const db = createDbMock([], []);
    const app = createApp(db, { orgId: null });
    app.get('/test', requirePermission('codebases.create'), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/middleware/permissions.test.ts`
Expected: FAIL — module not found

**Step 3: Write the permission middleware**

```typescript
// src/api/middleware/permissions.ts
import { and, eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { member, orgRolePermissions } from '../db/schema.js';
import type { Env } from '../index.js';

export function requirePermission(permission: string) {
  return async (c: Context<Env>, next: Next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    const session = c.get('session');
    const orgId = session?.activeOrganizationId;
    if (!orgId) return c.json({ error: 'No active organization' }, 400);

    const db = c.get('db');
    const [membership] = await db.select({
      role: member.role,
      roleId: member.roleId,
    }).from(member).where(
      and(eq(member.userId, user.id), eq(member.organizationId, orgId))
    ).limit(1);

    if (!membership) return c.json({ error: 'Not a member of this organization' }, 403);

    // Owner and admin bypass custom role checks
    if (membership.role === 'owner' || membership.role === 'admin') {
      return next();
    }

    // Check custom role permissions
    if (!membership.roleId) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const perms = await db.select({ permission: orgRolePermissions.permission })
      .from(orgRolePermissions)
      .where(eq(orgRolePermissions.roleId, membership.roleId));

    const hasPermission = perms.some(p => p.permission === permission);
    if (!hasPermission) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    return next();
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/middleware/permissions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/middleware/permissions.ts tests/api/middleware/permissions.test.ts
git commit -m "feat: add requirePermission middleware with custom org role support"
```

---

### Task 5: Add roles CRUD API routes

**Files:**
- Create: `src/api/routes/roles.ts`
- Create: `tests/api/routes/roles.test.ts`
- Modify: `src/api/index.ts` (register route)

**Step 1: Write unit tests**

```typescript
// tests/api/routes/roles.test.ts
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

describe('Roles API', () => {
  // Use mock DB pattern from org.test.ts (createDbMock + createTestApp)
  // Tests:
  // - POST / creates a role with permissions (200)
  // - POST / rejects duplicate name in same org (409)
  // - GET / lists roles for active org
  // - PUT /:id updates role name and permissions
  // - DELETE /:id deletes role (cascades permissions)
  // - DELETE /:id rejects deleting built-in roles (400)
  // - All routes require owner/admin (non-admin member gets 403)
});
```

**Step 2: Implement routes**

```typescript
// src/api/routes/roles.ts
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { orgRolePermissions, orgRoles } from '../db/schema.js';
import type { Env } from '../index.js';
import { requireAuth } from '../middleware/auth.js';

const VALID_PERMISSIONS = [
  'codebases.create', 'codebases.edit', 'codebases.delete', 'codebases.view_progress',
  'syllabi.create', 'syllabi.edit', 'syllabi.delete', 'syllabi.view_progress',
  'members.invite', 'members.manage_roles', 'members.view',
  'org.settings', 'org.billing',
] as const;

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(z.enum(VALID_PERMISSIONS)).min(1),
  isDefault: z.boolean().optional(),
});

export const roleRoutes = new Hono<Env>();
roleRoutes.use('*', requireAuth);

// POST / — create role (owner/admin only)
// GET / — list roles for active org
// PUT /:id — update role (owner/admin only)
// DELETE /:id — delete role (owner/admin only, not built-in)
```

**Step 3: Register in index.ts**

Add `app.route('/api/org/roles', roleRoutes);` after the existing org route.

**Step 4: Run tests, verify pass**

**Step 5: Commit**

```bash
git add src/api/routes/roles.ts tests/api/routes/roles.test.ts src/api/index.ts
git commit -m "feat: add CRUD API for custom org roles with permissions"
```

---

### Task 6: Seed built-in roles on org creation

**Files:**
- Modify: `src/api/lib/auth.ts`

**Step 1: Write test for role seeding**

Test that when an org is created via Better Auth, built-in Admin and Member roles are seeded.

**Step 2: Add organization afterCreate hook**

In the Better Auth config, add a hook that inserts the two built-in roles when an organization is created. Use `organization` plugin's `databaseHooks` or post-create logic.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add src/api/lib/auth.ts tests/
git commit -m "feat: seed built-in Admin and Member roles on org creation"
```

---

## Phase 2: Codebases CRUD API

### Task 7: Codebases CRUD routes

**Files:**
- Create: `src/api/routes/codebases.ts`
- Create: `tests/api/routes/codebases.test.ts`
- Modify: `src/api/index.ts`

**Step 1: Write tests for CRUD operations**

```
- POST /api/codebases — create codebase (requires codebases.create permission)
- GET /api/codebases — list codebases for active org
- GET /api/codebases/:id — detail with concepts and enrollment count
- PUT /api/codebases/:id — update name/status (requires codebases.edit)
- DELETE /api/codebases/:id — delete (requires codebases.delete)
- POST /api/codebases/:id/activate — draft → active
```

**Step 2: Implement routes following courses.ts pattern**

Use `requirePermission('codebases.create')` etc. for write operations. Read operations just need `requireAuth` + org membership.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add src/api/routes/codebases.ts tests/api/routes/codebases.test.ts src/api/index.ts
git commit -m "feat: add codebases CRUD API with permission checks"
```

---

### Task 8: Codebase concept management routes

**Files:**
- Modify: `src/api/routes/codebases.ts`
- Modify: `tests/api/routes/codebases.test.ts`

**Step 1: Write tests**

```
- POST /api/codebases/:id/concepts — add concept (with importance, learningObjective)
- DELETE /api/codebases/:id/concepts/:conceptId — remove concept
- PUT /api/codebases/:id/concepts/:conceptId — update importance/objective/curate
- GET /api/codebases/:id/concepts — list concepts with mastery data for requesting user
```

**Step 2: Implement routes**

Concept add resolves via existing three-tier normalization (call `resolveConcept` from concept-pipeline). Curate sets `curatedBy` and `autoExtracted: false`.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add src/api/routes/codebases.ts tests/api/routes/codebases.test.ts
git commit -m "feat: add codebase concept management routes"
```

---

### Task 9: Codebase enrollment and progress routes

**Files:**
- Modify: `src/api/routes/codebases.ts`
- Modify: `tests/api/routes/codebases.test.ts`

**Step 1: Write tests**

```
- POST /api/codebases/:id/enroll — self-enroll (any org member)
- GET /api/codebases/:id/progress — own progress (mastery per concept vs threshold)
- GET /api/codebases/:id/progress/:userId — member progress (requires codebases.view_progress)
- GET /api/codebases/:id/members — enrolled members with progress summary
```

**Step 2: Implement routes**

Progress = query `userConceptStates` for each concept in `codebase_concepts`. Threshold by importance: core=0.8, supporting=0.6, peripheral=0.4.

**Step 3: Run tests, verify pass**

**Step 4: Commit**

```bash
git add src/api/routes/codebases.ts tests/api/routes/codebases.test.ts
git commit -m "feat: add codebase enrollment and progress tracking"
```

---

## Phase 3: Syllabi CRUD API

### Task 10: Syllabi CRUD routes

**Files:**
- Create: `src/api/routes/syllabi.ts`
- Create: `tests/api/routes/syllabi.test.ts`
- Modify: `src/api/index.ts`

Mirror codebases CRUD pattern but without GitHub-specific fields. Add source management:

```
- POST /api/syllabi — create
- GET /api/syllabi — list for org
- GET /api/syllabi/:id — detail
- PUT /api/syllabi/:id — update
- DELETE /api/syllabi/:id — delete
- POST /api/syllabi/:id/sources — add source (pdf/url/markdown)
- DELETE /api/syllabi/:id/sources/:sourceId — remove source
- POST /api/syllabi/:id/concepts — add concept
- DELETE /api/syllabi/:id/concepts/:conceptId — remove
- POST /api/syllabi/:id/enroll — self-enroll
- GET /api/syllabi/:id/progress — own progress
- GET /api/syllabi/:id/progress/:userId — member progress
```

**Commit**

```bash
git add src/api/routes/syllabi.ts tests/api/routes/syllabi.test.ts src/api/index.ts
git commit -m "feat: add syllabi CRUD API with sources, concepts, enrollment"
```

---

## Phase 4: GitHub App Integration

### Task 11: GitHub App setup and installation flow

**Files:**
- Create: `src/api/routes/github.ts`
- Create: `src/api/lib/github.ts` (GitHub API client)
- Create: `tests/api/routes/github.test.ts`
- Modify: `src/api/index.ts`

**Routes:**

```
- GET /api/github/install-url — returns GitHub App installation URL
- GET /api/github/callback — handles installation callback, stores in github_installations
- GET /api/github/repos — lists repos accessible via installation
- POST /api/github/installations/:id/refresh-token — refresh expired installation token
```

**GitHub API client** (`src/api/lib/github.ts`):

```typescript
export class GitHubClient {
  constructor(private installationToken: string) {}

  async getRepoContents(owner: string, repo: string, path: string): Promise<GitHubFile[]> { ... }
  async getTree(owner: string, repo: string, sha: string): Promise<GitHubTreeEntry[]> { ... }
  async getFileContent(owner: string, repo: string, path: string): Promise<string> { ... }
}

export async function refreshInstallationToken(installationId: string, appPrivateKey: string): Promise<{ token: string; expiresAt: Date }> { ... }
```

**Commit**

```bash
git add src/api/routes/github.ts src/api/lib/github.ts tests/api/routes/github.test.ts src/api/index.ts
git commit -m "feat: add GitHub App installation flow and API client"
```

---

### Task 12: GitHub webhook handler

**Files:**
- Modify: `src/api/routes/github.ts`
- Modify: `tests/api/routes/github.test.ts`

**Route:**

```
- POST /api/github/webhook — receives push events, verifies signature, marks codebase sync_status
```

Verify webhook signature via HMAC-SHA256 with `GITHUB_WEBHOOK_SECRET`. On push to default branch, check if changed files overlap with tier 1-2 analysis files. If yes, set `sync_status: 'pending_review'`.

**Commit**

```bash
git add src/api/routes/github.ts tests/api/routes/github.test.ts
git commit -m "feat: add GitHub webhook handler for push-triggered sync detection"
```

---

### Task 13: Concept extraction agent

**Files:**
- Create: `src/api/lib/codebase-extraction.ts`
- Create: `tests/api/lib/codebase-extraction.test.ts`

**Core function:**

```typescript
export async function extractCodebaseConcepts(
  github: GitHubClient,
  owner: string,
  repo: string,
  tier: 1 | 2 | 3,
  deepDivePaths?: string[],
): Promise<ExtractedConcept[]> {
  // Tier 1: README, CLAUDE.md, package.json/Cargo.toml, dir tree
  // Tier 2: + entry points, schemas, routes, configs
  // Tier 3: + specific paths from deepDivePaths
  // Returns: [{ conceptId, importance, learningObjective }]
}
```

Uses Cloudflare Workers AI (already available as `env.AI`) or calls the existing LLM enrichment pipeline.

**Route to trigger extraction:**

```
- POST /api/codebases/:id/extract — triggers concept extraction (async, sets syncStatus)
```

**Commit**

```bash
git add src/api/lib/codebase-extraction.ts tests/api/lib/codebase-extraction.test.ts src/api/routes/codebases.ts
git commit -m "feat: add tiered concept extraction from GitHub repos"
```

---

## Phase 5: Probe Scoping

### Task 14: Add repoUrl to observe endpoint

**Files:**
- Modify: `src/api/routes/mcp.ts`
- Modify: `src/mcp/server.ts` (add repoUrl to observe tool input)
- Modify: `tests/api/routes/mcp.test.ts`

**Step 1: Add repoUrl to observe input schema**

In `src/mcp/server.ts`, add `repoUrl` as optional string to the `entendi_observe` tool input.

**Step 2: Resolve repoUrl to codebase in mcp.ts**

In the observe handler, if `repoUrl` is provided:
1. Parse owner/repo from the URL
2. Look up matching codebase by `githubRepoOwner` + `githubRepoName`
3. If found and user is enrolled (or in the org), boost urgency for codebase concepts by +0.3

**Step 3: Update plugin SessionStart hook**

Send the git remote URL as context so the MCP server can pass it to observe.

**Step 4: Tests and commit**

```bash
git add src/api/routes/mcp.ts src/mcp/server.ts plugin/hooks/ tests/
git commit -m "feat: scope probe selection to codebase concepts via repoUrl"
```

---

## Phase 6: Dashboard UI

### Task 15: Codebases tab in dashboard

**Files:**
- Modify: `src/dashboard/dashboard.js`
- Modify: `src/dashboard/dashboard.css`

Add a "Codebases" tab to the org section. List codebases with name, repo, concept count, sync status. Detail view with concept curation (approve/reject auto-extracted, add manual).

**Commit**

```bash
git add src/dashboard/dashboard.js src/dashboard/dashboard.css
git commit -m "feat: add codebases management UI to dashboard"
```

---

### Task 16: Syllabi tab in dashboard

**Files:**
- Modify: `src/dashboard/dashboard.js`
- Modify: `src/dashboard/dashboard.css`

Add a "Syllabi" tab. List syllabi, manage sources (upload PDF placeholder, add URL), curate concepts.

**Commit**

```bash
git add src/dashboard/dashboard.js src/dashboard/dashboard.css
git commit -m "feat: add syllabi management UI to dashboard"
```

---

### Task 17: Roles management in org settings

**Files:**
- Modify: `src/dashboard/dashboard.js`

Add roles section under Organization tab. List custom roles, create/edit with permission checkboxes, assign to members.

**Commit**

```bash
git add src/dashboard/dashboard.js
git commit -m "feat: add custom roles management UI to org settings"
```

---

## Phase 7: Cleanup

### Task 18: Deprecate courses

**Files:**
- Modify: `src/api/index.ts` (comment out course route registration)
- Modify: `src/dashboard/dashboard.js` (remove course UI if any)

Leave course tables in schema for backward compatibility. Remove from OpenAPI spec and dashboard navigation.

**Commit**

```bash
git add src/api/index.ts src/dashboard/dashboard.js
git commit -m "refactor: deprecate courses in favor of codebases and syllabi"
```

---

### Task 19: Deploy and push schema

**Step 1:** `npm run build`
**Step 2:** `npx wrangler deploy`
**Step 3:** `npx drizzle-kit push` (or apply migration SQL directly via Neon)
**Step 4:** Smoke test: create a codebase, add concepts, enroll, verify probe scoping

**Commit**

```bash
git commit -m "chore: deploy codebases and syllabi feature"
```
