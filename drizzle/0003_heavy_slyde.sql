CREATE TABLE "concept_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"canonical_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_analytics" (
	"user_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"first_assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_probes" integer DEFAULT 0 NOT NULL,
	"total_tutor_sessions" integer DEFAULT 0 NOT NULL,
	"total_dismissals" integer DEFAULT 0 NOT NULL,
	"peak_mastery" real DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"avg_response_word_count" real,
	"avg_integrity_score" real,
	CONSTRAINT "concept_analytics_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "concept_embeddings" (
	"concept_id" text PRIMARY KEY NOT NULL,
	"embedding" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_snapshots" (
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"assessment_count" integer DEFAULT 0 NOT NULL,
	"concepts_assessed" integer DEFAULT 0 NOT NULL,
	"avg_mastery_delta" real DEFAULT 0 NOT NULL,
	"total_dismissals" integer DEFAULT 0 NOT NULL,
	"avg_integrity_score" real,
	"probe_count" integer DEFAULT 0 NOT NULL,
	"tutor_count" integer DEFAULT 0 NOT NULL,
	"domains" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "daily_snapshots_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "device_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"api_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"summary_frequency" text DEFAULT 'weekly' NOT NULL,
	"transactional_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "response_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"avg_word_count" real DEFAULT 0 NOT NULL,
	"avg_char_count" real DEFAULT 0 NOT NULL,
	"avg_chars_per_second" real DEFAULT 0 NOT NULL,
	"avg_formatting_score" real DEFAULT 0 NOT NULL,
	"avg_vocab_complexity" real DEFAULT 0 NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"organization_id" text,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"seat_count" integer,
	"earned_free_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "zpd_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone,
	"mastery_at_entry" real NOT NULL,
	"mastery_at_exit" real
);
--> statement-breakpoint
ALTER TABLE "assessment_events" ADD COLUMN "response_features" jsonb;--> statement-breakpoint
ALTER TABLE "assessment_events" ADD COLUMN "integrity_score" real;--> statement-breakpoint
ALTER TABLE "concept_edges" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "concept_aliases" ADD CONSTRAINT "concept_aliases_canonical_id_concepts_id_fk" FOREIGN KEY ("canonical_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_analytics" ADD CONSTRAINT "concept_analytics_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_analytics" ADD CONSTRAINT "concept_analytics_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_embeddings" ADD CONSTRAINT "concept_embeddings_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_snapshots" ADD CONSTRAINT "daily_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_profiles" ADD CONSTRAINT "response_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zpd_snapshots" ADD CONSTRAINT "zpd_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zpd_snapshots" ADD CONSTRAINT "zpd_snapshots_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_concept_aliases_canonical" ON "concept_aliases" USING btree ("canonical_id");--> statement-breakpoint
CREATE INDEX "idx_daily_snapshots_user_date" ON "daily_snapshots" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_user" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_org" ON "subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_stripe_customer" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "idx_zpd_snapshots_user_concept" ON "zpd_snapshots" USING btree ("user_id","concept_id");--> statement-breakpoint
CREATE INDEX "idx_zpd_snapshots_user_entered" ON "zpd_snapshots" USING btree ("user_id","entered_at");--> statement-breakpoint
ALTER TABLE "assessment_events" ADD CONSTRAINT "assessment_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_events" ADD CONSTRAINT "assessment_events_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;