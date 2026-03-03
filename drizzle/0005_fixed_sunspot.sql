CREATE TABLE "contact_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "press_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"published_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_signups" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_signups_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "event_annotations" DROP CONSTRAINT "event_annotations_author_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonatedBy" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banReason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banExpires" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "onboardingCompletedAt" timestamp;--> statement-breakpoint
ALTER TABLE "event_annotations" ADD CONSTRAINT "event_annotations_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_user" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_apikey_user" ON "apikey" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_assessment_events_user_created" ON "assessment_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_concept_edges_source_type" ON "concept_edges" USING btree ("source_id","edge_type");--> statement-breakpoint
CREATE INDEX "idx_concepts_domain" ON "concepts" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_course_enrollments_course_user" ON "course_enrollments" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_course_modules_course" ON "course_modules" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_courses_owner" ON "courses" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_device_codes_status" ON "device_codes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_dismissal_events_user_created" ON "dismissal_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_invitation_org" ON "invitation" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "idx_member_user" ON "member" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_member_org" ON "member" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "idx_session_user" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_tutor_exchanges_session" ON "tutor_exchanges" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_tutor_sessions_user_concept" ON "tutor_sessions" USING btree ("user_id","concept_id");