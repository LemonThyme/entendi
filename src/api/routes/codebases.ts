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
  member,
  userConceptStates,
} from '../db/schema.js';
import type { Env } from '../index.js';
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
  curate: z.boolean().optional(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown, c: Context<Env>): T | Response {
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.issues }, 400);
  }
  return result.data;
}

function getOrgId(c: Context<Env>): string | null {
  const session = c.get('session');
  return session?.activeOrganizationId ?? null;
}

const IMPORTANCE_THRESHOLDS: Record<string, number> = {
  core: 0.8,
  supporting: 0.6,
  peripheral: 0.4,
};

// --- POST / (create codebase) ---
codebaseRoutes.post('/', requirePermission('codebases.create'), async (c) => {
  const db = c.get('db');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

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

// --- GET / (list codebases for active org) ---
codebaseRoutes.get('/', async (c) => {
  const db = c.get('db');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const rows = await db.select().from(codebases).where(eq(codebases.orgId, orgId));
  return c.json(rows);
});

// --- GET /:id (detail with concepts and enrollment count) ---
codebaseRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [codebase] = await db.select().from(codebases).where(
    and(eq(codebases.id, id), eq(codebases.orgId, orgId)),
  );
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const conceptRows = await db.select().from(codebaseConcepts).where(eq(codebaseConcepts.codebaseId, id));
  const enrollmentRows = await db.select().from(codebaseEnrollments).where(eq(codebaseEnrollments.codebaseId, id));

  return c.json({ ...codebase, concepts: conceptRows, enrollmentCount: enrollmentRows.length });
});

// --- PUT /:id (update name/status) ---
codebaseRoutes.put('/:id', requirePermission('codebases.edit'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [existing] = await db.select().from(codebases).where(
    and(eq(codebases.id, id), eq(codebases.orgId, orgId)),
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json();
  const parsed = parseBody(updateCodebaseSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const updates: Record<string, any> = {};
  if (parsed.name) updates.name = parsed.name;
  if (parsed.status) updates.status = parsed.status;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  await db.update(codebases).set(updates).where(eq(codebases.id, id));

  const [updated] = await db.select().from(codebases).where(eq(codebases.id, id));
  return c.json(updated);
});

// --- DELETE /:id ---
codebaseRoutes.delete('/:id', requirePermission('codebases.delete'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [existing] = await db.select().from(codebases).where(
    and(eq(codebases.id, id), eq(codebases.orgId, orgId)),
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.delete(codebases).where(eq(codebases.id, id));
  return c.json({ deleted: true });
});

// --- POST /:id/activate (draft → active) ---
codebaseRoutes.post('/:id/activate', requirePermission('codebases.edit'), async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [codebase] = await db.select().from(codebases).where(
    and(eq(codebases.id, id), eq(codebases.orgId, orgId)),
  );
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  await db.update(codebases).set({ status: 'active' }).where(eq(codebases.id, id));
  return c.json({ id, status: 'active' });
});

// --- POST /:id/concepts (add concept) ---
codebaseRoutes.post('/:id/concepts', requirePermission('codebases.edit'), async (c) => {
  const db = c.get('db');
  const codebaseId = c.req.param('id');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [codebase] = await db.select().from(codebases).where(
    and(eq(codebases.id, codebaseId), eq(codebases.orgId, orgId)),
  );
  if (!codebase) return c.json({ error: 'Codebase not found' }, 404);

  const raw = await c.req.json();
  const parsed = parseBody(addConceptSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const [concept] = await db.select().from(concepts).where(eq(concepts.id, parsed.conceptId));
  if (!concept) return c.json({ error: 'Concept not found' }, 404);

  const user = c.get('user')!;
  await db.insert(codebaseConcepts).values({
    codebaseId,
    conceptId: parsed.conceptId,
    importance: parsed.importance,
    learningObjective: parsed.learningObjective ?? null,
    autoExtracted: false,
    curatedBy: user.id,
  });

  const [created] = await db.select().from(codebaseConcepts).where(
    and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, parsed.conceptId)),
  );
  return c.json(created, 201);
});

// --- PUT /:id/concepts/:conceptId (update concept) ---
codebaseRoutes.put('/:id/concepts/:conceptId', requirePermission('codebases.edit'), async (c) => {
  const db = c.get('db');
  const codebaseId = c.req.param('id');
  const conceptId = c.req.param('conceptId');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [existing] = await db.select().from(codebaseConcepts).where(
    and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)),
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json();
  const parsed = parseBody(updateConceptSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const updates: Record<string, any> = {};
  if (parsed.importance) updates.importance = parsed.importance;
  if (parsed.learningObjective !== undefined) updates.learningObjective = parsed.learningObjective;
  if (parsed.curate) {
    const user = c.get('user')!;
    updates.autoExtracted = false;
    updates.curatedBy = user.id;
  }

  await db.update(codebaseConcepts).set(updates).where(
    and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)),
  );

  const [updated] = await db.select().from(codebaseConcepts).where(
    and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)),
  );
  return c.json(updated);
});

// --- DELETE /:id/concepts/:conceptId ---
codebaseRoutes.delete('/:id/concepts/:conceptId', requirePermission('codebases.edit'), async (c) => {
  const db = c.get('db');
  const codebaseId = c.req.param('id');
  const conceptId = c.req.param('conceptId');

  const [existing] = await db.select().from(codebaseConcepts).where(
    and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)),
  );
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.delete(codebaseConcepts).where(
    and(eq(codebaseConcepts.codebaseId, codebaseId), eq(codebaseConcepts.conceptId, conceptId)),
  );
  return c.json({ deleted: true });
});

// --- GET /:id/concepts (list concepts with mastery for current user) ---
codebaseRoutes.get('/:id/concepts', async (c) => {
  const db = c.get('db');
  const codebaseId = c.req.param('id');
  const user = c.get('user')!;
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [codebase] = await db.select().from(codebases).where(
    and(eq(codebases.id, codebaseId), eq(codebases.orgId, orgId)),
  );
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const conceptRows = await db.select().from(codebaseConcepts).where(eq(codebaseConcepts.codebaseId, codebaseId));

  const withMastery = await Promise.all(conceptRows.map(async (cc) => {
    const [ucs] = await db.select().from(userConceptStates).where(
      and(eq(userConceptStates.userId, user.id), eq(userConceptStates.conceptId, cc.conceptId)),
    );
    const mu = ucs?.mu ?? 0.0;
    const mastery = pMastery(mu);
    const threshold = IMPORTANCE_THRESHOLDS[cc.importance] ?? 0.6;
    return { ...cc, mastery, threshold, met: mastery >= threshold };
  }));

  return c.json(withMastery);
});

// --- POST /:id/enroll (self-enroll, any org member) ---
codebaseRoutes.post('/:id/enroll', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const codebaseId = c.req.param('id');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [codebase] = await db.select().from(codebases).where(
    and(eq(codebases.id, codebaseId), eq(codebases.orgId, orgId)),
  );
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  // Verify org membership
  const [membership] = await db.select({ role: member.role }).from(member).where(
    and(eq(member.userId, user.id), eq(member.organizationId, orgId)),
  ).limit(1);
  if (!membership) return c.json({ error: 'Not a member of this organization' }, 403);

  const [existing] = await db.select().from(codebaseEnrollments).where(
    and(eq(codebaseEnrollments.codebaseId, codebaseId), eq(codebaseEnrollments.userId, user.id)),
  );
  if (existing) return c.json({ error: 'Already enrolled' }, 409);

  await db.insert(codebaseEnrollments).values({
    codebaseId,
    userId: user.id,
  });

  const [enrollment] = await db.select().from(codebaseEnrollments).where(
    and(eq(codebaseEnrollments.codebaseId, codebaseId), eq(codebaseEnrollments.userId, user.id)),
  );
  return c.json(enrollment, 201);
});

// --- GET /:id/progress (own progress) ---
codebaseRoutes.get('/:id/progress', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const codebaseId = c.req.param('id');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [codebase] = await db.select().from(codebases).where(
    and(eq(codebases.id, codebaseId), eq(codebases.orgId, orgId)),
  );
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  return c.json(await buildProgress(db, codebaseId, user.id));
});

// --- GET /:id/progress/:userId (member progress) ---
codebaseRoutes.get('/:id/progress/:userId', requirePermission('codebases.view_progress'), async (c) => {
  const db = c.get('db');
  const codebaseId = c.req.param('id');
  const userId = c.req.param('userId');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [codebase] = await db.select().from(codebases).where(
    and(eq(codebases.id, codebaseId), eq(codebases.orgId, orgId)),
  );
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  return c.json(await buildProgress(db, codebaseId, userId));
});

// --- GET /:id/members (enrolled members with progress summary) ---
codebaseRoutes.get('/:id/members', requirePermission('codebases.view_progress'), async (c) => {
  const db = c.get('db');
  const codebaseId = c.req.param('id');
  const orgId = getOrgId(c);
  if (!orgId) return c.json({ error: 'No active organization' }, 400);

  const [codebase] = await db.select().from(codebases).where(
    and(eq(codebases.id, codebaseId), eq(codebases.orgId, orgId)),
  );
  if (!codebase) return c.json({ error: 'Not found' }, 404);

  const enrollments = await db.select().from(codebaseEnrollments).where(eq(codebaseEnrollments.codebaseId, codebaseId));

  const members = await Promise.all(enrollments.map(async (e) => {
    const progress = await buildProgress(db, codebaseId, e.userId);
    return { userId: e.userId, enrolledAt: e.enrolledAt, status: e.status, completionRatio: progress.completionRatio };
  }));

  return c.json(members);
});

// --- Shared progress helper ---

async function buildProgress(db: any, codebaseId: string, userId: string) {
  const conceptRows = await db.select().from(codebaseConcepts).where(eq(codebaseConcepts.codebaseId, codebaseId));

  if (conceptRows.length === 0) {
    return { codebaseId, userId, concepts: [], completionRatio: 0 };
  }

  const conceptProgress = await Promise.all(conceptRows.map(async (cc: any) => {
    const [ucs] = await db.select().from(userConceptStates).where(
      and(eq(userConceptStates.userId, userId), eq(userConceptStates.conceptId, cc.conceptId)),
    );
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
