CREATE TABLE "anomaly_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"z_self" real DEFAULT 0 NOT NULL,
	"z_population" real DEFAULT 0 NOT NULL,
	"dismiss_ratio" real DEFAULT 0 NOT NULL,
	"mastery_velocity" real DEFAULT 0 NOT NULL,
	"composite_score" real DEFAULT 0 NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_concepts" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"module_id" text,
	"concept_id" text NOT NULL,
	"learning_objective" text,
	"required_mastery_threshold" real DEFAULT 0.7 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"user_id" text NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"name" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" text NOT NULL,
	"org_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dismissal_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"probe_token_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "probe_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"depth" smallint NOT NULL,
	"evaluation_criteria" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"signature" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "concepts" DROP CONSTRAINT "concepts_parent_id_concepts_id_fk";
--> statement-breakpoint
ALTER TABLE "assessment_events" ADD COLUMN "probe_token_id" text;--> statement-breakpoint
ALTER TABLE "assessment_events" ADD COLUMN "response_text" text;--> statement-breakpoint
ALTER TABLE "assessment_events" ADD COLUMN "evaluation_criteria" text;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD COLUMN "probe_token_id" text;--> statement-breakpoint
ALTER TABLE "tutor_sessions" ADD COLUMN "research_performed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tutor_sessions" ADD COLUMN "sources" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "anomaly_scores" ADD CONSTRAINT "anomaly_scores_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_concepts" ADD CONSTRAINT "course_concepts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_concepts" ADD CONSTRAINT "course_concepts_module_id_course_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."course_modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_concepts" ADD CONSTRAINT "course_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissal_events" ADD CONSTRAINT "dismissal_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissal_events" ADD CONSTRAINT "dismissal_events_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissal_events" ADD CONSTRAINT "dismissal_events_probe_token_id_probe_tokens_id_fk" FOREIGN KEY ("probe_token_id") REFERENCES "public"."probe_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_tokens" ADD CONSTRAINT "probe_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probe_tokens" ADD CONSTRAINT "probe_tokens_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_anomaly_scores_user" ON "anomaly_scores" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_course_concepts_course" ON "course_concepts" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_course_enrollments_user" ON "course_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_dismissal_events_user_concept" ON "dismissal_events" USING btree ("user_id","concept_id");--> statement-breakpoint
CREATE INDEX "idx_probe_tokens_user" ON "probe_tokens" USING btree ("user_id");