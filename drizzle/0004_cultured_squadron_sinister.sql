CREATE TABLE "event_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dismissal_events" ADD COLUMN "reason" text DEFAULT 'topic_change' NOT NULL;--> statement-breakpoint
ALTER TABLE "dismissal_events" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "dismissal_events" ADD COLUMN "requeued" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dismissal_events" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dismissal_events" ADD COLUMN "resolved_as" text;--> statement-breakpoint
ALTER TABLE "event_annotations" ADD CONSTRAINT "event_annotations_event_id_assessment_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."assessment_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_annotations" ADD CONSTRAINT "event_annotations_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_event_annotations_event" ON "event_annotations" USING btree ("event_id");