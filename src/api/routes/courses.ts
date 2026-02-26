import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { courses, courseModules, courseConcepts, courseEnrollments, concepts, userConceptStates } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { pMastery } from '../../schemas/types.js';
import type { Env } from '../index.js';
import type { Context } from 'hono';

export const courseRoutes = new Hono<Env>();

// All course routes require authentication
courseRoutes.use('*', requireAuth);

// --- Zod schemas ---

const createCourseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  orgId: z.string().max(200).optional(),
});

const addConceptSchema = z.object({
  conceptId: z.string().min(1).max(200),
  moduleId: z.string().max(200).optional(),
  learningObjective: z.string().max(2000).optional(),
  requiredMasteryThreshold: z.number().min(0).max(1).default(0.7),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown, c: Context<Env>): T | Response {
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation error', details: result.error.issues }, 400);
  }
  return result.data;
}

// --- POST / (create course) ---
courseRoutes.post('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const raw = await c.req.json();
  const parsed = parseBody(createCourseSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  const id = crypto.randomUUID();

  await db.insert(courses).values({
    id,
    name: parsed.name,
    description: parsed.description ?? '',
    status: 'draft',
    ownerId: user.id,
    orgId: parsed.orgId ?? null,
  });

  const [created] = await db.select().from(courses).where(eq(courses.id, id));
  return c.json(created, 201);
});

// --- GET / (list courses owned by user) ---
courseRoutes.get('/', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;

  const rows = await db.select().from(courses).where(eq(courses.ownerId, user.id));
  return c.json(rows);
});

// --- GET /:id (course details with concepts and modules) ---
courseRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [course] = await db.select().from(courses).where(eq(courses.id, id));
  if (!course) return c.json({ error: 'Not found' }, 404);

  const conceptRows = await db.select().from(courseConcepts).where(eq(courseConcepts.courseId, id));
  const moduleRows = await db.select().from(courseModules).where(eq(courseModules.courseId, id));

  return c.json({ ...course, concepts: conceptRows, modules: moduleRows });
});

// --- POST /:id/concepts (add concept to course) ---
courseRoutes.post('/:id/concepts', async (c) => {
  const db = c.get('db');
  const courseId = c.req.param('id');
  const raw = await c.req.json();
  const parsed = parseBody(addConceptSchema, raw, c);
  if (parsed instanceof Response) return parsed;

  // Verify course exists
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return c.json({ error: 'Course not found' }, 404);

  // Verify concept exists
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, parsed.conceptId));
  if (!concept) return c.json({ error: 'Concept not found' }, 404);

  // Verify module exists if provided
  if (parsed.moduleId) {
    const [mod] = await db.select().from(courseModules).where(
      and(eq(courseModules.id, parsed.moduleId), eq(courseModules.courseId, courseId)),
    );
    if (!mod) return c.json({ error: 'Module not found in this course' }, 404);
  }

  const [created] = await db.insert(courseConcepts).values({
    courseId,
    conceptId: parsed.conceptId,
    moduleId: parsed.moduleId ?? null,
    learningObjective: parsed.learningObjective ?? null,
    requiredMasteryThreshold: parsed.requiredMasteryThreshold,
  }).returning();
  return c.json(created, 201);
});

// --- POST /:id/activate (set status to active) ---
courseRoutes.post('/:id/activate', async (c) => {
  const db = c.get('db');
  const courseId = c.req.param('id');

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return c.json({ error: 'Not found' }, 404);

  await db.update(courses).set({
    status: 'active',
    updatedAt: new Date(),
  }).where(eq(courses.id, courseId));

  return c.json({ id: courseId, status: 'active' });
});

// --- POST /:id/enroll (enroll the authenticated user) ---
courseRoutes.post('/:id/enroll', async (c) => {
  const db = c.get('db');
  const user = c.get('user')!;
  const courseId = c.req.param('id');

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return c.json({ error: 'Not found' }, 404);

  // Check for existing enrollment
  const [existing] = await db.select().from(courseEnrollments).where(
    and(eq(courseEnrollments.courseId, courseId), eq(courseEnrollments.userId, user.id)),
  );
  if (existing) return c.json({ error: 'Already enrolled' }, 409);

  const [enrollment] = await db.insert(courseEnrollments).values({
    courseId,
    userId: user.id,
  }).returning();
  return c.json(enrollment, 201);
});

// --- GET /:id/progress/:userId (student progress) ---
courseRoutes.get('/:id/progress/:userId', async (c) => {
  const db = c.get('db');
  const courseId = c.req.param('id');
  const userId = c.req.param('userId');

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course) return c.json({ error: 'Not found' }, 404);

  // Get all course concepts
  const conceptRows = await db.select().from(courseConcepts).where(eq(courseConcepts.courseId, courseId));

  if (conceptRows.length === 0) {
    return c.json({ courseId, userId, concepts: [], completionRatio: 0 });
  }

  // Get user mastery states for all course concepts
  const conceptProgress = await Promise.all(conceptRows.map(async (cc) => {
    const [ucs] = await db.select().from(userConceptStates).where(
      and(eq(userConceptStates.userId, userId), eq(userConceptStates.conceptId, cc.conceptId)),
    );

    const mu = ucs?.mu ?? 0.0;
    const mastery = pMastery(mu);
    const threshold = cc.requiredMasteryThreshold;
    const met = mastery >= threshold;

    return {
      conceptId: cc.conceptId,
      learningObjective: cc.learningObjective,
      mastery,
      threshold,
      met,
    };
  }));

  const metCount = conceptProgress.filter(cp => cp.met).length;
  const completionRatio = conceptProgress.length > 0 ? metCount / conceptProgress.length : 0;

  return c.json({ courseId, userId, concepts: conceptProgress, completionRatio });
});
