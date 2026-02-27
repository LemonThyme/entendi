import { pgTable, text, real, integer, smallint, boolean, timestamp, jsonb, primaryKey, index, serial, date } from 'drizzle-orm/pg-core';

// --- Auth (Better Auth) ---

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  activeOrganizationId: text('activeOrganizationId'),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt'),
  updatedAt: timestamp('updatedAt'),
});

// --- Auth: Organization plugin ---

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export const member = pgTable('member', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organizationId').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  inviterId: text('inviterId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organizationId').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  status: text('status').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

// --- Auth: API Key plugin ---

export const apikey = pgTable('apikey', {
  id: text('id').primaryKey(),
  name: text('name'),
  start: text('start'),
  prefix: text('prefix'),
  key: text('key').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  refillInterval: integer('refillInterval'),
  refillAmount: integer('refillAmount'),
  lastRefillAt: timestamp('lastRefillAt'),
  enabled: boolean('enabled').default(true),
  rateLimitEnabled: boolean('rateLimitEnabled').default(false),
  rateLimitTimeWindow: integer('rateLimitTimeWindow'),
  rateLimitMax: integer('rateLimitMax'),
  requestCount: integer('requestCount').default(0),
  remaining: integer('remaining'),
  lastRequest: timestamp('lastRequest'),
  expiresAt: timestamp('expiresAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  permissions: text('permissions'),
  metadata: text('metadata'),
});

// --- Concepts ---

export const concepts = pgTable('concepts', {
  id: text('id').primaryKey(),
  aliases: text('aliases').array().notNull().default([]),
  domain: text('domain').notNull(),
  specificity: text('specificity').notNull(),
  parentId: text('parent_id'),
  description: text('description').notNull().default(''),
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
  source: text('source').notNull().default('manual'),
}, (table) => [
  primaryKey({ columns: [table.sourceId, table.targetId, table.edgeType] }),
  index('idx_concept_edges_target').on(table.targetId),
]);

// --- Concept Embeddings (pgvector) ---

export const conceptEmbeddings = pgTable('concept_embeddings', {
  conceptId: text('concept_id').primaryKey().references(() => concepts.id, { onDelete: 'cascade' }),
  embedding: text('embedding').notNull(), // JSON-serialized float array; actual DB column is vector(768) via migration
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Concept Aliases (normalization) ---

export const conceptAliases = pgTable('concept_aliases', {
  alias: text('alias').primaryKey(),
  canonicalId: text('canonical_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_concept_aliases_canonical').on(table.canonicalId),
]);

// --- User Mastery ---

export const userConceptStates = pgTable('user_concept_states', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
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

// --- Assessment History ---

export const assessmentEvents = pgTable('assessment_events', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  rubricScore: smallint('rubric_score').notNull(),
  evaluatorConfidence: real('evaluator_confidence').notNull(),
  muBefore: real('mu_before').notNull(),
  muAfter: real('mu_after').notNull(),
  probeDepth: smallint('probe_depth').notNull(),
  tutored: boolean('tutored').notNull().default(false),
  probeTokenId: text('probe_token_id'),
  responseText: text('response_text'),
  evaluationCriteria: text('evaluation_criteria'),
  responseFeatures: jsonb('response_features'),
  integrityScore: real('integrity_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_assessment_events_user_concept').on(table.userId, table.conceptId),
  index('idx_assessment_events_created').on(table.createdAt),
]);

// --- Tutor Sessions ---

export const tutorSessions = pgTable('tutor_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id),
  phase: text('phase').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  triggerScore: smallint('trigger_score'),
  phase1Score: smallint('phase1_score'),
  phase4Score: smallint('phase4_score'),
  lastMisconception: text('last_misconception'),
  researchPerformed: boolean('research_performed').notNull().default(false),
  sources: text('sources').array().notNull().default([]),
});

export const tutorExchanges = pgTable('tutor_exchanges', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => tutorSessions.id, { onDelete: 'cascade' }),
  phase: text('phase').notNull(),
  question: text('question').notNull(),
  response: text('response'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Probe Sessions ---

export const probeSessions = pgTable('probe_sessions', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  pendingConceptId: text('pending_concept_id').references(() => concepts.id),
  pendingProbeData: jsonb('pending_probe_data'),
  lastProbeTime: timestamp('last_probe_time', { withTimezone: true }),
  probesThisSession: integer('probes_this_session').notNull().default(0),
});

// --- Pending Actions ---

export const pendingActions = pgTable('pending_actions', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  actionType: text('action_type').notNull(),
  data: jsonb('data').notNull(),
  probeTokenId: text('probe_token_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Probe Tokens ---

export const probeTokens = pgTable('probe_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  depth: smallint('depth').notNull(),
  evaluationCriteria: text('evaluation_criteria').notNull().default(''),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  signature: text('signature').notNull(),
}, (table) => [
  index('idx_probe_tokens_user').on(table.userId),
]);

// --- Event Annotations ---

export const eventAnnotations = pgTable('event_annotations', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id').notNull().references(() => assessmentEvents.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_event_annotations_event').on(table.eventId),
]);

// --- Dismissal Events ---

export const dismissalEvents = pgTable('dismissal_events', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  probeTokenId: text('probe_token_id').references(() => probeTokens.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_dismissal_events_user_concept').on(table.userId, table.conceptId),
]);

// --- Anomaly Scores ---

export const anomalyScores = pgTable('anomaly_scores', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  zSelf: real('z_self').notNull().default(0),
  zPopulation: real('z_population').notNull().default(0),
  dismissRatio: real('dismiss_ratio').notNull().default(0),
  masteryVelocity: real('mastery_velocity').notNull().default(0),
  compositeScore: real('composite_score').notNull().default(0),
  signals: jsonb('signals').notNull().default({}),
}, (table) => [
  index('idx_anomaly_scores_user').on(table.userId),
]);

// --- Courses ---

export const courses = pgTable('courses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  orgId: text('org_id').references(() => organization.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const courseModules = pgTable('course_modules', {
  id: text('id').primaryKey(),
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
});

export const courseConcepts = pgTable('course_concepts', {
  id: serial('id').primaryKey(),
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  moduleId: text('module_id').references(() => courseModules.id, { onDelete: 'set null' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  learningObjective: text('learning_objective'),
  requiredMasteryThreshold: real('required_mastery_threshold').notNull().default(0.7),
}, (table) => [
  index('idx_course_concepts_course').on(table.courseId),
]);

export const courseEnrollments = pgTable('course_enrollments', {
  id: serial('id').primaryKey(),
  courseId: text('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('active'),
}, (table) => [
  index('idx_course_enrollments_user').on(table.userId),
]);

// --- Device Codes (CLI-first auth linking) ---

export const deviceCodes = pgTable('device_codes', {
  code: text('code').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  apiKey: text('api_key'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Subscriptions (Stripe billing) ---

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  plan: text('plan').notNull(),
  status: text('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  seatCount: integer('seat_count'),
  earnedFreeUntil: timestamp('earned_free_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_subscriptions_user').on(table.userId),
  index('idx_subscriptions_org').on(table.organizationId),
  index('idx_subscriptions_stripe_customer').on(table.stripeCustomerId),
]);

// --- Response Profiles ---

export const responseProfiles = pgTable('response_profiles', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  avgWordCount: real('avg_word_count').notNull().default(0),
  avgCharCount: real('avg_char_count').notNull().default(0),
  avgCharsPerSecond: real('avg_chars_per_second').notNull().default(0),
  avgFormattingScore: real('avg_formatting_score').notNull().default(0),
  avgVocabComplexity: real('avg_vocab_complexity').notNull().default(0),
  sampleCount: integer('sample_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Email Preferences ---

export const emailPreferences = pgTable('email_preferences', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  summaryFrequency: text('summary_frequency').notNull().default('weekly'),
  transactionalEnabled: boolean('transactional_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Analytics (materialized on-write) ---

export const dailySnapshots = pgTable('daily_snapshots', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(),
  assessmentCount: integer('assessment_count').notNull().default(0),
  conceptsAssessed: integer('concepts_assessed').notNull().default(0),
  avgMasteryDelta: real('avg_mastery_delta').notNull().default(0),
  totalDismissals: integer('total_dismissals').notNull().default(0),
  avgIntegrityScore: real('avg_integrity_score'),
  probeCount: integer('probe_count').notNull().default(0),
  tutorCount: integer('tutor_count').notNull().default(0),
  domains: jsonb('domains').notNull().default({}),
}, (table) => [
  primaryKey({ columns: [table.userId, table.date] }),
  index('idx_daily_snapshots_user_date').on(table.userId, table.date),
]);

export const zpdSnapshots = pgTable('zpd_snapshots', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
  exitedAt: timestamp('exited_at', { withTimezone: true }),
  masteryAtEntry: real('mastery_at_entry').notNull(),
  masteryAtExit: real('mastery_at_exit'),
}, (table) => [
  index('idx_zpd_snapshots_user_concept').on(table.userId, table.conceptId),
  index('idx_zpd_snapshots_user_entered').on(table.userId, table.enteredAt),
]);

export const conceptAnalytics = pgTable('concept_analytics', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conceptId: text('concept_id').notNull().references(() => concepts.id, { onDelete: 'cascade' }),
  firstAssessedAt: timestamp('first_assessed_at', { withTimezone: true }).notNull().defaultNow(),
  lastAssessedAt: timestamp('last_assessed_at', { withTimezone: true }).notNull().defaultNow(),
  totalProbes: integer('total_probes').notNull().default(0),
  totalTutorSessions: integer('total_tutor_sessions').notNull().default(0),
  totalDismissals: integer('total_dismissals').notNull().default(0),
  peakMastery: real('peak_mastery').notNull().default(0),
  currentStreak: integer('current_streak').notNull().default(0),
  longestStreak: integer('longest_streak').notNull().default(0),
  avgResponseWordCount: real('avg_response_word_count'),
  avgIntegrityScore: real('avg_integrity_score'),
}, (table) => [
  primaryKey({ columns: [table.userId, table.conceptId] }),
]);
