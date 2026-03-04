import { and, count, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { pMastery } from '../../schemas/types.js';
import { concepts, member, syllabi, syllabusConcepts, syllabusEnrollments, syllabusSources, userConceptStates } from '../db/schema.js';
import type { Env } from '../index.js';
import { resolveOrgId } from '../lib/resolve-org.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';

export const syllabiRoutes = new Hono<Env>();

syllabiRoutes.use('*', requireAuth);

// --- Zod schemas ---

const createSyllabusSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

const updateSyllabusSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

const addSourceSchema = z.object({
  sourceType: z.enum(['pdf', 'url', 'markdown', 'manual']),
  sourceUrl: z.string().max(2000).optional(),
  fileName: z.string().max(500).optional(),
});

const addConceptSchema = z.object({
  conceptId: z.string().min(1).max(200),
  importance: z.enum(['core', 'supporting', 'peripheral']).optional(),
  learningObjective: z.string().max(2000).optional(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown, c: Context<Env>): T | Response {
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.issues }, 400);
  }
  return result.data;
}

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

/** Fetch a syllabus that belongs to the given org, or null. */
async function getSyllabusForOrg(c: Context<Env>, syllabusId: string, orgId: string) {
  const db = c.get('db');
  const [syllabus] = await db.select().from(syllabi)
    .where(and(eq(syllabi.id, syllabusId), eq(syllabi.orgId, orgId)));
  return syllabus ?? null;
}

// --- POST / (create syllabus) ---
syllabiRoutes.post('/', requirePermission('syllabi.create'), async (c) => {
  const db = c.get('db');
  const orgId = (await resolveOrgId(c))!;
  const raw = await c.req.json();
  const parsed = parseBody(createSyllabusSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const id = crypto.randomUUID();

  await db.insert(syllabi).values({
    id,
    name: parsed.name,
    description: parsed.description ?? '',
    orgId,
    status: 'draft',
  });

  const [created] = await db.select().from(syllabi).where(eq(syllabi.id, id));
  return c.json(created, 201);
});

// --- GET / (list syllabi for active org) ---
syllabiRoutes.get('/', async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const db = c.get('db');
  const rows = await db.select().from(syllabi).where(eq(syllabi.orgId, orgId));
  return c.json(rows);
});

// --- GET /:id (detail with sources, concept count, enrollment count) ---
syllabiRoutes.get('/:id', async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const id = c.req.param('id');
  const syllabus = await getSyllabusForOrg(c, id, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const sources = await db.select().from(syllabusSources).where(eq(syllabusSources.syllabusId, id));
  const [conceptCountRow] = await db.select({ value: count() }).from(syllabusConcepts).where(eq(syllabusConcepts.syllabusId, id));
  const [enrollmentCountRow] = await db.select({ value: count() }).from(syllabusEnrollments).where(eq(syllabusEnrollments.syllabusId, id));

  return c.json({
    ...syllabus,
    sources,
    conceptCount: conceptCountRow.value,
    enrollmentCount: enrollmentCountRow.value,
  });
});

// --- PUT /:id (update syllabus) ---
syllabiRoutes.put('/:id', requirePermission('syllabi.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const id = c.req.param('id');

  const syllabus = await getSyllabusForOrg(c, id, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json();
  const parsed = parseBody(updateSyllabusSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const db = c.get('db');
  const updates: Record<string, unknown> = {};
  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.description !== undefined) updates.description = parsed.description;
  if (parsed.status !== undefined) updates.status = parsed.status;

  if (Object.keys(updates).length > 0) {
    await db.update(syllabi).set(updates).where(eq(syllabi.id, id));
  }

  const [updated] = await db.select().from(syllabi).where(eq(syllabi.id, id));
  return c.json(updated);
});

// --- DELETE /:id (delete syllabus) ---
syllabiRoutes.delete('/:id', requirePermission('syllabi.delete'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const id = c.req.param('id');

  const syllabus = await getSyllabusForOrg(c, id, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  await db.delete(syllabi).where(eq(syllabi.id, id));
  return c.json({ deleted: true });
});

// --- POST /:id/sources (add source) ---
syllabiRoutes.post('/:id/sources', requirePermission('syllabi.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const syllabusId = c.req.param('id');

  const syllabus = await getSyllabusForOrg(c, syllabusId, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const raw = await c.req.json();
  const parsed = parseBody(addSourceSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const id = crypto.randomUUID();

  const [created] = await db.insert(syllabusSources).values({
    id,
    syllabusId,
    sourceType: parsed.sourceType,
    sourceUrl: parsed.sourceUrl ?? null,
    fileName: parsed.fileName ?? null,
    extractionStatus: 'pending',
  }).returning();

  return c.json(created, 201);
});

// --- DELETE /:id/sources/:sourceId (remove source) ---
syllabiRoutes.delete('/:id/sources/:sourceId', requirePermission('syllabi.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const syllabusId = c.req.param('id');

  const syllabus = await getSyllabusForOrg(c, syllabusId, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const sourceId = c.req.param('sourceId');

  const [source] = await db.select().from(syllabusSources).where(
    and(eq(syllabusSources.id, sourceId), eq(syllabusSources.syllabusId, syllabusId)),
  );
  if (!source) return c.json({ error: 'Not found' }, 404);

  await db.delete(syllabusSources).where(eq(syllabusSources.id, sourceId));
  return c.json({ deleted: true });
});

// --- POST /:id/concepts (add concept) ---
syllabiRoutes.post('/:id/concepts', requirePermission('syllabi.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const syllabusId = c.req.param('id');

  const syllabus = await getSyllabusForOrg(c, syllabusId, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const raw = await c.req.json();
  const parsed = parseBody(addConceptSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const [concept] = await db.select().from(concepts).where(eq(concepts.id, parsed.conceptId));
  if (!concept) return c.json({ error: 'Concept not found' }, 404);

  const [created] = await db.insert(syllabusConcepts).values({
    syllabusId,
    conceptId: parsed.conceptId,
    importance: parsed.importance ?? 'supporting',
    learningObjective: parsed.learningObjective ?? null,
    autoExtracted: false,
  }).returning();

  return c.json(created, 201);
});

// --- DELETE /:id/concepts/:conceptId (remove concept) ---
syllabiRoutes.delete('/:id/concepts/:conceptId', requirePermission('syllabi.edit'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const syllabusId = c.req.param('id');

  const syllabus = await getSyllabusForOrg(c, syllabusId, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const conceptId = c.req.param('conceptId');

  const [sc] = await db.select().from(syllabusConcepts).where(
    and(eq(syllabusConcepts.syllabusId, syllabusId), eq(syllabusConcepts.conceptId, conceptId)),
  );
  if (!sc) return c.json({ error: 'Not found' }, 404);

  await db.delete(syllabusConcepts).where(
    and(eq(syllabusConcepts.syllabusId, syllabusId), eq(syllabusConcepts.conceptId, conceptId)),
  );
  return c.json({ deleted: true });
});

// --- POST /:id/enroll (self-enroll, any org member) ---
syllabiRoutes.post('/:id/enroll', async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const db = c.get('db');
  const user = c.get('user')!;
  const syllabusId = c.req.param('id');

  const syllabus = await getSyllabusForOrg(c, syllabusId, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  // Check for duplicate enrollment
  const [existing] = await db.select().from(syllabusEnrollments).where(
    and(eq(syllabusEnrollments.syllabusId, syllabusId), eq(syllabusEnrollments.userId, user.id)),
  );
  if (existing) return c.json({ error: 'Already enrolled' }, 409);

  const [enrollment] = await db.insert(syllabusEnrollments).values({
    syllabusId,
    userId: user.id,
  }).returning();

  return c.json(enrollment, 201);
});

// --- GET /:id/progress (own progress) ---
syllabiRoutes.get('/:id/progress', async (c) => {
  const orgResult = await requireOrgMembership(c);
  if (orgResult instanceof Response) return orgResult;
  const { orgId } = orgResult;

  const user = c.get('user')!;
  const syllabusId = c.req.param('id');

  const syllabus = await getSyllabusForOrg(c, syllabusId, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  return getProgress(db, syllabusId, user.id, c);
});

// --- GET /:id/progress/:userId (member progress) ---
syllabiRoutes.get('/:id/progress/:userId', requirePermission('syllabi.view_progress'), async (c) => {
  const orgId = (await resolveOrgId(c))!;
  const syllabusId = c.req.param('id');

  const syllabus = await getSyllabusForOrg(c, syllabusId, orgId);
  if (!syllabus) return c.json({ error: 'Not found' }, 404);

  const db = c.get('db');
  const userId = c.req.param('userId');

  return getProgress(db, syllabusId, userId, c);
});

// Importance → mastery threshold mapping
const IMPORTANCE_THRESHOLDS: Record<string, number> = {
  core: 0.8,
  supporting: 0.6,
  peripheral: 0.4,
};

async function getProgress(db: any, syllabusId: string, userId: string, c: Context<Env>) {
  const conceptRows = await db.select().from(syllabusConcepts).where(eq(syllabusConcepts.syllabusId, syllabusId));

  if (conceptRows.length === 0) {
    return c.json({ syllabusId, userId, concepts: [], completionRatio: 0 });
  }

  const conceptProgress = await Promise.all(conceptRows.map(async (sc: any) => {
    const [ucs] = await db.select().from(userConceptStates).where(
      and(eq(userConceptStates.userId, userId), eq(userConceptStates.conceptId, sc.conceptId)),
    );

    const mu = ucs?.mu ?? 0.0;
    const mastery = pMastery(mu);
    const threshold = IMPORTANCE_THRESHOLDS[sc.importance] ?? 0.6;
    const met = mastery >= threshold;

    return {
      conceptId: sc.conceptId,
      importance: sc.importance,
      learningObjective: sc.learningObjective,
      mastery,
      threshold,
      met,
    };
  }));

  const metCount = conceptProgress.filter((cp: any) => cp.met).length;
  const completionRatio = conceptProgress.length > 0 ? metCount / conceptProgress.length : 0;

  return c.json({ syllabusId, userId, concepts: conceptProgress, completionRatio });
}
