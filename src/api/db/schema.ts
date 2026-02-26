import { pgTable, text, real, integer, smallint, boolean, timestamp, jsonb, primaryKey, index, serial } from 'drizzle-orm/pg-core';

// --- Concepts ---

export const concepts = pgTable('concepts', {
  id: text('id').primaryKey(),
  aliases: text('aliases').array().notNull().default([]),
  domain: text('domain').notNull(),
  specificity: text('specificity').notNull(),
  parentId: text('parent_id').references(() => concepts.id),
  discrimination: real('discrimination').notNull().default(1.0),
  threshold1: real('threshold_1').notNull().default(-1.0),
  threshold2: real('threshold_2').notNull().default(0.0),
  threshold3: real('threshold_3').notNull().default(1.0),
  lifecycle: text('lifecycle').notNull().default('discovered'),
  popMeanMastery: real('pop_mean_mastery').notNull().default(0.0),
  popAssessmentCount: integer('pop_assessment_count').notNull().default(0),
  popFailureRate: real('pop_failure_rate').notNull().default(0.0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conceptEdges = pgTable('concept_edges', {
  sourceId: text('source_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  edgeType: text('edge_type').notNull(),
}, (table) => [
  primaryKey({ columns: [table.sourceId, table.targetId, table.edgeType] }),
  index('idx_concept_edges_target').on(table.targetId),
]);

export const userConceptStates = pgTable('user_concept_states', {
  userId: text('user_id').notNull(),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  mu: real('mu').notNull().default(0.0),
  sigma: real('sigma').notNull().default(1.5),
  stability: real('stability').notNull().default(1.0),
  difficulty: real('difficulty').notNull().default(5.0),
  lastAssessed: timestamp('last_assessed', { withTimezone: true }),
  assessmentCount: integer('assessment_count').notNull().default(0),
  tutoredCount: integer('tutored_count').notNull().default(0),
  untutoredCount: integer('untutored_count').notNull().default(0),
  muUntutored: real('mu_untutored').notNull().default(0.0),
  sigmaUntutored: real('sigma_untutored').notNull().default(1.5),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.conceptId] }),
]);

export const assessmentEvents = pgTable('assessment_events', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  conceptId: text('concept_id').notNull(),
  eventType: text('event_type').notNull(),
  rubricScore: smallint('rubric_score').notNull(),
  evaluatorConfidence: real('evaluator_confidence').notNull(),
  muBefore: real('mu_before').notNull(),
  muAfter: real('mu_after').notNull(),
  probeDepth: smallint('probe_depth').notNull(),
  tutored: boolean('tutored').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_assessment_events_user_concept').on(table.userId, table.conceptId),
  index('idx_assessment_events_created').on(table.createdAt),
]);

export const tutorSessions = pgTable('tutor_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  conceptId: text('concept_id').notNull().references(() => concepts.id),
  phase: text('phase').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  triggerScore: smallint('trigger_score'),
  phase1Score: smallint('phase1_score'),
  phase4Score: smallint('phase4_score'),
  lastMisconception: text('last_misconception'),
});

export const tutorExchanges = pgTable('tutor_exchanges', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => tutorSessions.id, { onDelete: 'cascade' }),
  phase: text('phase').notNull(),
  question: text('question').notNull(),
  response: text('response'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const probeSessions = pgTable('probe_sessions', {
  userId: text('user_id').primaryKey(),
  pendingConceptId: text('pending_concept_id').references(() => concepts.id),
  pendingProbeData: jsonb('pending_probe_data'),
  lastProbeTime: timestamp('last_probe_time', { withTimezone: true }),
  probesThisSession: integer('probes_this_session').notNull().default(0),
});

export const pendingActions = pgTable('pending_actions', {
  userId: text('user_id').primaryKey(),
  actionType: text('action_type').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
