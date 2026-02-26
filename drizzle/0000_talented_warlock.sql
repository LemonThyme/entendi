CREATE TABLE "assessment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"event_type" text NOT NULL,
	"rubric_score" smallint NOT NULL,
	"evaluator_confidence" real NOT NULL,
	"mu_before" real NOT NULL,
	"mu_after" real NOT NULL,
	"probe_depth" smallint NOT NULL,
	"tutored" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_edges" (
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"edge_type" text NOT NULL,
	CONSTRAINT "concept_edges_source_id_target_id_edge_type_pk" PRIMARY KEY("source_id","target_id","edge_type")
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" text PRIMARY KEY NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"domain" text NOT NULL,
	"specificity" text NOT NULL,
	"parent_id" text,
	"discrimination" real DEFAULT 1 NOT NULL,
	"threshold_1" real DEFAULT -1 NOT NULL,
	"threshold_2" real DEFAULT 0 NOT NULL,
	"threshold_3" real DEFAULT 1 NOT NULL,
	"lifecycle" text DEFAULT 'discovered' NOT NULL,
	"pop_mean_mastery" real DEFAULT 0 NOT NULL,
	"pop_assessment_count" integer DEFAULT 0 NOT NULL,
	"pop_failure_rate" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"action_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "probe_sessions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"pending_concept_id" text,
	"pending_probe_data" jsonb,
	"last_probe_time" timestamp with time zone,
	"probes_this_session" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_exchanges" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"phase" text NOT NULL,
	"question" text NOT NULL,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutor_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"phase" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger_score" smallint,
	"phase1_score" smallint,
	"phase4_score" smallint,
	"last_misconception" text
);
--> statement-breakpoint
CREATE TABLE "user_concept_states" (
	"user_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"mu" real DEFAULT 0 NOT NULL,
	"sigma" real DEFAULT 1.5 NOT NULL,
	"stability" real DEFAULT 1 NOT NULL,
	"difficulty" real DEFAULT 5 NOT NULL,
	"last_assessed" timestamp with time zone,
	"assessment_count" integer DEFAULT 0 NOT NULL,
	"tutored_count" integer DEFAULT 0 NOT NULL,
	"untutored_count" integer DEFAULT 0 NOT NULL,
	"mu_untutored" real DEFAULT 0 NOT NULL,
	"sigma_untutored" real DEFAULT 1.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_concept_states_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id")
);
--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_source_id_concepts_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_target_id_concepts_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_parent_id_concepts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_sessions" ADD CONSTRAINT "probe_sessions_pending_concept_id_concepts_id_fk" FOREIGN KEY ("pending_concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_exchanges" ADD CONSTRAINT "tutor_exchanges_session_id_tutor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tutor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_sessions" ADD CONSTRAINT "tutor_sessions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_concept_states" ADD CONSTRAINT "user_concept_states_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_assessment_events_user_concept" ON "assessment_events" USING btree ("user_id","concept_id");--> statement-breakpoint
CREATE INDEX "idx_assessment_events_created" ON "assessment_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_concept_edges_target" ON "concept_edges" USING btree ("target_id");