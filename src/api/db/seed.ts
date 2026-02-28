import { buildSeedConceptNodes } from '../../config/seed-taxonomy.js';
import type { Database } from './connection.js';
import { conceptEdges, concepts } from './schema.js';

export async function seedTaxonomy(db: Database) {
  const seedConcepts = buildSeedConceptNodes();
  const conceptIds = new Set(Object.keys(seedConcepts));

  // Upsert concepts
  for (const node of Object.values(seedConcepts)) {
    await db.insert(concepts).values({
      id: node.conceptId,
      aliases: node.aliases,
      domain: node.domain,
      specificity: node.specificity,
      parentId: node.parentConcept,
      discrimination: node.itemParams.discrimination,
      threshold1: node.itemParams.thresholds[0],
      threshold2: node.itemParams.thresholds[1],
      threshold3: node.itemParams.thresholds[2],
      lifecycle: node.lifecycle,
      popMeanMastery: node.populationStats.meanMastery,
      popAssessmentCount: node.populationStats.assessmentCount,
      popFailureRate: node.populationStats.failureRate,
    }).onConflictDoNothing();
  }

  // Insert edges (after all concepts exist)
  for (const node of Object.values(seedConcepts)) {
    for (const edge of node.relationships) {
      if (conceptIds.has(edge.target)) {
        await db.insert(conceptEdges).values({
          sourceId: node.conceptId,
          targetId: edge.target,
          edgeType: edge.type,
        }).onConflictDoNothing();
      }
    }
  }

  return { conceptCount: conceptIds.size };
}

// CLI entry point
async function main() {
  const { config } = await import('dotenv');
  config();
  const { createDb } = await import('./connection.js');
  const db = createDb(process.env.DATABASE_URL!);
  console.log('Seeding taxonomy...');
  const result = await seedTaxonomy(db);
  console.log(`Seeded ${result.conceptCount} concepts.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch(console.error);
}
