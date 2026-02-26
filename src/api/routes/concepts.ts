import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { concepts, conceptEdges } from '../db/schema.js';
import type { Env } from '../index.js';

export const conceptRoutes = new Hono<Env>();

// List all concepts (with optional domain filter)
conceptRoutes.get('/', async (c) => {
  const db = c.get('db');
  const domain = c.req.query('domain');

  const rows = domain
    ? await db.select().from(concepts).where(eq(concepts.domain, domain))
    : await db.select().from(concepts);

  return c.json(rows);
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
