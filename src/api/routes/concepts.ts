import { eq, ilike, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { conceptEdges, concepts } from '../db/schema.js';
import type { Env } from '../index.js';
import { requireAuth } from '../middleware/auth.js';

export const conceptRoutes = new Hono<Env>();

// List all concepts (with optional domain filter or search)
conceptRoutes.get('/', async (c) => {
  const db = c.get('db');
  const domain = c.req.query('domain');
  const search = c.req.query('search');

  if (search) {
    const pattern = `%${search}%`;
    const rows = await db.select().from(concepts).where(
      or(
        ilike(concepts.id, pattern),
        ilike(concepts.domain, pattern),
        sql`${pattern} = ANY(${concepts.aliases})`,
      ),
    );
    return c.json(rows);
  }

  const rows = domain
    ? await db.select().from(concepts).where(eq(concepts.domain, domain))
    : await db.select().from(concepts);

  return c.json(rows);
});

// Create or upsert a concept
conceptRoutes.post('/', requireAuth, async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{
    id: string;
    domain?: string;
    specificity?: string;
    aliases?: string[];
    parentId?: string;
  }>();

  if (!body.id) return c.json({ error: 'id is required' }, 400);

  // Normalize ID: lowercase, hyphens
  const id = body.id.toLowerCase().replace(/[\s/]+/g, '-').replace(/[^a-z0-9\-_.@]/g, '');

  const [existing] = await db.select().from(concepts).where(eq(concepts.id, id));

  if (existing) {
    // Upsert: merge aliases, update domain/specificity if provided
    const mergedAliases = [...new Set([...(existing.aliases || []), ...(body.aliases || [])])];
    await db.update(concepts).set({
      ...(body.domain && { domain: body.domain }),
      ...(body.specificity && { specificity: body.specificity }),
      aliases: mergedAliases,
      updatedAt: new Date(),
    }).where(eq(concepts.id, id));

    const [updated] = await db.select().from(concepts).where(eq(concepts.id, id));
    return c.json(updated);
  }

  // Create new
  await db.insert(concepts).values({
    id,
    domain: body.domain || 'general',
    specificity: body.specificity || 'topic',
    aliases: body.aliases || [],
    parentId: body.parentId || null,
  });

  const [created] = await db.select().from(concepts).where(eq(concepts.id, id));
  return c.json(created, 201);
});

// Batch create/upsert concepts
conceptRoutes.post('/batch', requireAuth, async (c) => {
  const db = c.get('db');
  const body = await c.req.json<{
    concepts: Array<{
      id: string;
      domain?: string;
      specificity?: string;
      aliases?: string[];
      parentId?: string;
    }>;
  }>();

  const results: any[] = [];
  for (const item of body.concepts) {
    const id = item.id.toLowerCase().replace(/[\s/]+/g, '-').replace(/[^a-z0-9\-_.@]/g, '');

    await db.insert(concepts).values({
      id,
      domain: item.domain || 'general',
      specificity: item.specificity || 'topic',
      aliases: item.aliases || [],
      parentId: item.parentId || null,
    }).onConflictDoUpdate({
      target: concepts.id,
      set: {
        ...(item.domain && { domain: item.domain }),
        ...(item.specificity && { specificity: item.specificity }),
        aliases: item.aliases || [],
        updatedAt: new Date(),
      },
    });

    results.push({ id, status: 'ok' });
  }

  return c.json({ created: results.length, results });
});

// Get single concept with edges
conceptRoutes.get('/:id', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const [concept] = await db.select().from(concepts).where(eq(concepts.id, id));
  if (!concept) return c.json({ error: 'Not found' }, 404);

  const edges = await db.select().from(conceptEdges).where(eq(conceptEdges.sourceId, id));
  return c.json({ ...concept, edges });
});

// Update a concept
conceptRoutes.put('/:id', requireAuth, async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json<{
    domain?: string;
    specificity?: string;
    aliases?: string[];
    parentId?: string | null;
  }>();

  const [existing] = await db.select().from(concepts).where(eq(concepts.id, id));
  if (!existing) return c.json({ error: 'Not found' }, 404);

  await db.update(concepts).set({
    ...(body.domain !== undefined && { domain: body.domain }),
    ...(body.specificity !== undefined && { specificity: body.specificity }),
    ...(body.aliases !== undefined && { aliases: body.aliases }),
    ...(body.parentId !== undefined && { parentId: body.parentId }),
    updatedAt: new Date(),
  }).where(eq(concepts.id, id));

  const [updated] = await db.select().from(concepts).where(eq(concepts.id, id));
  return c.json(updated);
});

// Create an edge between concepts
conceptRoutes.post('/:id/edges', requireAuth, async (c) => {
  const db = c.get('db');
  const sourceId = c.req.param('id');
  const body = await c.req.json<{
    targetId: string;
    edgeType: string;
  }>();

  await db.insert(conceptEdges).values({
    sourceId,
    targetId: body.targetId,
    edgeType: body.edgeType,
  }).onConflictDoNothing();

  return c.json({ ok: true });
});

// Recursive prerequisites
conceptRoutes.get('/:id/prerequisites', async (c) => {
  const db = c.get('db');
  const id = c.req.param('id');

  const result = await db.execute(sql`
    WITH RECURSIVE prereqs AS (
      SELECT target_id AS concept_id, 1 AS depth
      FROM concept_edges
      WHERE source_id = ${id} AND edge_type = 'requires'
      UNION ALL
      SELECT e.target_id, p.depth + 1
      FROM concept_edges e
      JOIN prereqs p ON e.source_id = p.concept_id
      WHERE e.edge_type = 'requires' AND p.depth < 10
    )
    SELECT DISTINCT concept_id, MIN(depth) as depth FROM prereqs GROUP BY concept_id ORDER BY depth
  `);

  return c.json(result.rows);
});
