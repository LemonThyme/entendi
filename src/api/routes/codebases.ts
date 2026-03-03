import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { pMastery } from '../../schemas/types.js';
import {
  codebaseConcepts,
  codebaseEnrollments,
  codebases,
  concepts,
  githubInstallations,
  member,
  userConceptStates,
} from '../db/schema.js';
import type { Env } from '../index.js';
import { extractCodebaseConcepts } from '../lib/codebase-extraction.js';
import { GitHubClient } from '../lib/github.js';
import { resolveOrgId } from '../lib/resolve-org.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

export const codebaseRoutes = new Hono<Env>();

codebaseRoutes.use('*', requireAuth);

// --- Zod schemas ---

const createCodebaseSchema = z.object({
  name: z.string().min(1).max(200),
  githubRepoOwner: z.string().max(200).optional(),
  githubRepoName: z.string().max(200).optional(),
  githubRepoId: z.string().max(200).optional(),
  githubInstallationId: z.string().max(200).optional(),
});

const updateCodebaseSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

const addConceptSchema = z.object({
  conceptId: z.string().min(1).max(200),
  importance: z.enum(['core', 'supporting', 'peripheral']).default('supporting'),
  learningObjective: z.string().max(2000).optional(),
});

const updateConceptSchema = z.object({
  importance: z.enum(['core', 'supporting', 'peripheral']).optional(),
  learningObjective: z.string().max(2000).optional(),
  autoExtracted: z.boolean().optional(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown, c: Context<Env>): T | Response {
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.issues }, 400);
  }
  return result.data;
}

const IMPORTANCE_THRESHOLDS: Record<string, number> = {
  core: 0.8,
  supporting: 0.6,
  peripheral: 0.4,
};

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

/** Fetch a codebase that belongs to the given org, or null. */
async function getCodebaseForOrg(c: Context<Env>, codebaseId: string, orgId: string) {
  const db = c.get('db');
  const [codebase] = await db.select().from(codebases)
    .where(and(eq(codebases.id, codebaseId), eq(codebases.orgId, orgId)));
  return codebase ?? null;
}

// --- POST / (create codebase) ---
codebaseRoutes.post('/', requirePermission('codebases.create'), async (c) => {
  const db = c.get('db');
  const orgId = (await resolveOrgId(c))!;

  const raw = await c.req.json();
  const parsed = parseBody(createCodebaseSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const id = crypto.randomUUID();

  await db.insert(codebases).values({
    id,
    name: parsed.name,
    orgId,
    githubRepoOwner: parsed.githubRepoOwner ?? null,
    githubRepoName: parsed.githubRepoName ?? null,
    githubRepoId: parsed.githubRepoId ?? null,
    githubInstallationId: parsed.githubInstallationId ?? null,
  });

  const [created] = await db.select().from(codebases).where(eq(codebases.id, id));
  return c.json(created, 201);
});

// --- GET / (list codebases for active org with counts) ---
codebaseRoutes.get('/', async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const db = c.get('db');
  const rows = await db.select().from(codebases).where(eq(codebases.orgId, orgId));

  const result = await Promise.all(rows.map(async (cb: any) => {
    const conceptRows = await db.select().from(codebaseConcepts)
      .where(eq(codebaseConcepts.codebaseId, cb.id));
    const enrollmentRows = await db.select().from(codebaseEnrollments)
      .where(eq(codebaseEnrollments.codebaseId, cb.id));
    return { ...cb, conceptCount: conceptRows.length, enrollmentCount: enrollmentRows.length };
  }));

  return c.json(result);
});

// --- GET /:id (detail with concepts and enrollment count) ---
codebaseRoutes.get('/:id', async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const codebaseId = c.req.param('id');
  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const conceptRows = await db.select().from(codebaseConcepts)
    .where(eq(codebaseConcepts.codebaseId, codebaseId));
  const enrollmentRows = await db.select().from(codebaseEnrollments)
    .where(eq(codebaseEnrollments.codebaseId, codebaseId));

  return c.json({ ...codebase, concepts: conceptRows, enrollmentCount: enrollmentRows.length });
});

// --- PUT /:id (update name/status) ---
codebaseRoutes.put('/:id', requirePermission('codebases.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const codebaseId = c.req.param('id');

  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json();
  const parsed = parseBody(updateCodebaseSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const db = c.get('db');
  const updates: Record<string, unknown> = {};
  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.status !== undefined) updates.status = parsed.status;

  if (Object.keys(updates).length > 0) {
    await db.update(codebases).set(updates).where(eq(codebases.id, codebaseId));
  }

  const [updated] = await db.select().from(codebases).where(eq(codebases.id, codebaseId));
  return c.json(updated);
});

// --- DELETE /:id ---
codebaseRoutes.delete('/:id', requirePermission('codebases.delete'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const codebaseId = c.req.param('id');

  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  await db.delete(codebases).where(eq(codebases.id, codebaseId));
  return c.json({ deleted: true });
});

// --- POST /:id/activate (draft -> active) ---
codebaseRoutes.post('/:id/activate', requirePermission('codebases.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const codebaseId = c.req.param('id');

  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  await db.update(codebases).set({ status: 'active' }).where(eq(codebases.id, codebaseId));
  return c.json({ id: codebaseId, status: 'active' });
});

// --- POST /:id/concepts (add concept) ---
codebaseRoutes.post('/:id/concepts', requirePermission('codebases.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const codebaseId = c.req.param('id');

  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Codebase not found' }, 404);

  const raw = await c.req.json();
  const parsed = parseBody(addConceptSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const db = c.get('db');
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, parsed.conceptId));
  if (!concept) return c.json({ error: 'Concept not found' }, 404);

  const user = c.get('user')!;
  const [created] = await db.insert(codebaseConcepts).values({
    codebaseId,
    conceptId: parsed.conceptId,
    importance: parsed.importance,
    learningObjective: parsed.learningObjective ?? null,
    autoExtracted: false,
    curatedBy: user.id,
  }).returning();

  return c.json(created, 201);
});

// --- PUT /:id/concepts/:conceptId (update concept metadata) ---
codebaseRoutes.put('/:id/concepts/:conceptId', requirePermission('codebases.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const codebaseId = c.req.param('id');
  const conceptId = c.req.param('conceptId');

  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Codebase not found' }, 404);

  const db = c.get('db');
  const [existing] = await db.select().from(codebaseConcepts)
    .where(and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)));
  if (!existing) return c.json({ error: 'Concept not found in this codebase' }, 404);

  const raw = await c.req.json();
  const parsed = parseBody(updateConceptSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const user = c.get('user')!;
  const updates: Record<string, unknown> = { curatedBy: user.id };
  if (parsed.importance !== undefined) updates.importance = parsed.importance;
  if (parsed.learningObjective !== undefined) updates.learningObjective = parsed.learningObjective;
  if (parsed.autoExtracted !== undefined) updates.autoExtracted = parsed.autoExtracted;

  await db.update(codebaseConcepts).set(updates)
    .where(and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)));

  const [updated] = await db.select().from(codebaseConcepts)
    .where(and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)));
  return c.json(updated);
});

// --- DELETE /:id/concepts/:conceptId ---
codebaseRoutes.delete('/:id/concepts/:conceptId', requirePermission('codebases.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const codebaseId = c.req.param('id');
  const conceptId = c.req.param('conceptId');

  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Codebase not found' }, 404);

  const db = c.get('db');
  const [existing] = await db.select().from(codebaseConcepts)
    .where(and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)));
  if (!existing) return c.json({ error: 'Concept not found in this codebase' }, 404);

  await db.delete(codebaseConcepts)
    .where(and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)));
  return c.json({ deleted: true });
});

// --- GET /:id/concepts (list concepts with mastery for current user) ---
codebaseRoutes.get('/:id/concepts', async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const codebaseId = c.req.param('id');
  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const user = c.get('user')!;
  const conceptRows = await db.select().from(codebaseConcepts)
    .where(eq(codebaseConcepts.codebaseId, codebaseId));

  const withMastery = await Promise.all(conceptRows.map(async (cc: any) => {
    const [ucs] = await db.select().from(userConceptStates)
      .where(and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, cc.conceptId)));
    const mu = ucs?.mu ?? 0.0;
    const mastery = pMastery(mu);
    const threshold = IMPORTANCE_THRESHOLDS[cc.importance] ?? 0.6;
    return { ...cc, mastery, threshold, met: mastery >= threshold };
  }));

  return c.json(withMastery);
});

// --- POST /:id/enroll (self-enroll, any org member) ---
codebaseRoutes.post('/:id/enroll', async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const codebaseId = c.req.param('id');
  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const user = c.get('user')!;

  const [existing] = await db.select().from(codebaseEnrollments)
    .where(and(eq(codebaseEnrollments.codebaseId, codebaseId), eq(codebaseEnrollments.userId, user.id)));
  if (existing) return c.json({ error: 'Already enrolled' }, 409);

  const [enrollment] = await db.insert(codebaseEnrollments).values({
    codebaseId,
    userId: user.id,
  }).returning();

  return c.json(enrollment, 201);
});

// --- GET /:id/progress (own progress) ---
codebaseRoutes.get('/:id/progress', async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const codebaseId = c.req.param('id');
  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const user = c.get('user')!;
  return c.json(await buildProgress(db, codebaseId, user.id));
});

// --- GET /:id/progress/:userId (member progress) ---
codebaseRoutes.get('/:id/progress/:userId', requirePermission('codebases.view_progress'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const codebaseId = c.req.param('id');
  const userId = c.req.param('userId');

  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  return c.json(await buildProgress(db, codebaseId, userId));
});

// --- GET /:id/members (enrolled members with progress summary) ---
codebaseRoutes.get('/:id/members', requirePermission('codebases.view_progress'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const codebaseId = c.req.param('id');

  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const enrollments = await db.select().from(codebaseEnrollments)
    .where(eq(codebaseEnrollments.codebaseId, codebaseId));

  const members = await Promise.all(enrollments.map(async (e: any) => {
    const progress = await buildProgress(db, codebaseId, e.userId);
    return { userId: e.userId, enrolledAt: e.enrolledAt, status: e.status, completionRatio: progress.completionRatio };
  }));

  return c.json(members);
});

// --- POST /:id/extract (trigger concept extraction) ---
codebaseRoutes.post('/:id/extract', requirePermission('codebases.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const codebaseId = c.req.param('id');

  const codebase = await getCodebaseForOrg(c, codebaseId, orgId);
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  if (!codebase.githubRepoOwner || !codebase.githubRepoName || !codebase.githubInstallationId) {
    return c.json({ error: 'Codebase is not linked to a GitHub repository' }, 400);
  }

  const db = c.get('db');

  // Look up installation token
  const [installation] = await db.select().from(githubInstallations)
    .where(eq(githubInstallations.id, codebase.githubInstallationId));

  if (!installation?.accessToken) {
    return c.json({ error: 'No valid GitHub installation token' }, 400);
  }

  // Set sync status to syncing
  await db.update(codebases).set({ syncStatus: 'syncing' }).where(eq(codebases.id, codebaseId));

  // Parse tier from body (default to 1)
  let tier: 1 | 2 | 3 = 1;
  let deepDivePaths: string[] | undefined;
  try {
    const body = await c.req.json();
    if (body.tier === 2 || body.tier === 3) tier = body.tier;
    if (Array.isArray(body.deepDivePaths)) deepDivePaths = body.deepDivePaths;
  } catch { /* no body is fine, use defaults */ }

  // Fire-and-forget: run extraction in the background
  const github = new GitHubClient(installation.accessToken);
  extractCodebaseConcepts(github, codebase.githubRepoOwner, codebase.githubRepoName, tier, deepDivePaths)
    .then(async (extracted) => {
      // Store extracted concepts
      const user = c.get('user')!;
      for (const concept of extracted) {
        // Find or skip concept by name (concept must already exist)
        const [existing] = await db.select().from(concepts).where(eq(concepts.id, concept.conceptName));
        if (existing) {
          await db.insert(codebaseConcepts).values({
            codebaseId,
            conceptId: existing.id,
            importance: concept.importance,
            learningObjective: concept.learningObjective,
            autoExtracted: true,
            curatedBy: user.id,
          }).onConflictDoNothing();
        }
      }
      await db.update(codebases).set({ syncStatus: 'synced', lastSyncAt: new Date() })
        .where(eq(codebases.id, codebaseId));
    })
    .catch(async () => {
      await db.update(codebases).set({ syncStatus: 'error' })
        .where(eq(codebases.id, codebaseId));
    });

  return c.json({ id: codebaseId, syncStatus: 'syncing' }, 202);
});

// --- Shared progress helper ---

async function buildProgress(db: any, codebaseId: string, userId: string) {
  const conceptRows = await db.select().from(codebaseConcepts)
    .where(eq(codebaseConcepts.codebaseId, codebaseId));

  if (conceptRows.length === 0) {
    return { codebaseId, userId, concepts: [], completionRatio: 0 };
  }

  const conceptProgress = await Promise.all(conceptRows.map(async (cc: any) => {
    const [ucs] = await db.select().from(userConceptStates)
      .where(and(eq(userConceptStates.userId, userId), eq(userConceptStates.conceptId, cc.conceptId)));
    const mu = ucs?.mu ?? 0.0;
    const mastery = pMastery(mu);
    const threshold = IMPORTANCE_THRESHOLDS[cc.importance] ?? 0.6;
    return {
      conceptId: cc.conceptId,
      importance: cc.importance,
      learningObjective: cc.learningObjective,
      mastery,
      threshold,
      met: mastery >= threshold,
    };
  }));

  const metCount = conceptProgress.filter((cp: any) => cp.met).length;
  const completionRatio = metCount / conceptProgress.length;

  return { codebaseId, userId, concepts: conceptProgress, completionRatio };
}
