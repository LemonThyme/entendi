CREATE TABLE "codebase_concepts" (
	"codebase_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"importance" text DEFAULT 'supporting' NOT NULL,
	"learning_objective" text,
	"auto_extracted" boolean DEFAULT true NOT NULL,
	"curated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codebase_concepts_codebase_id_concept_id_pk" PRIMARY KEY("codebase_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "codebase_enrollments" (
	"codebase_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codebase_enrollments_codebase_id_user_id_pk" PRIMARY KEY("codebase_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "codebases" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"org_id" text NOT NULL,
	"github_repo_owner" text,
	"github_repo_name" text,
	"github_repo_id" text,
	"github_installation_id" text,
	"last_sync_commit" text,
	"last_sync_at" timestamp with time zone,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"github_org_login" text NOT NULL,
	"installed_by" text NOT NULL,
	"access_token" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_role_permissions" (
	"role_id" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "org_role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "org_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_org_roles_name" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "syllabi" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"org_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "syllabus_concepts" (
	"syllabus_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"importance" text DEFAULT 'supporting' NOT NULL,
	"learning_objective" text,
	"auto_extracted" boolean DEFAULT true NOT NULL,
	"curated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "syllabus_concepts_syllabus_id_concept_id_pk" PRIMARY KEY("syllabus_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "syllabus_enrollments" (
	"syllabus_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "syllabus_enrollments_syllabus_id_user_id_pk" PRIMARY KEY("syllabus_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "syllabus_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"syllabus_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"file_name" text,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "role_id" text;--> statement-breakpoint
ALTER TABLE "codebase_concepts" ADD CONSTRAINT "codebase_concepts_codebase_id_codebases_id_fk" FOREIGN KEY ("codebase_id") REFERENCES "public"."codebases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_concepts" ADD CONSTRAINT "codebase_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_concepts" ADD CONSTRAINT "codebase_concepts_curated_by_user_id_fk" FOREIGN KEY ("curated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_enrollments" ADD CONSTRAINT "codebase_enrollments_codebase_id_codebases_id_fk" FOREIGN KEY ("codebase_id") REFERENCES "public"."codebases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_enrollments" ADD CONSTRAINT "codebase_enrollments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebases" ADD CONSTRAINT "codebases_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebases" ADD CONSTRAINT "codebases_github_installation_id_github_installations_id_fk" FOREIGN KEY ("github_installation_id") REFERENCES "public"."github_installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_installed_by_user_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_permissions" ADD CONSTRAINT "org_role_permissions_role_id_org_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_roles" ADD CONSTRAINT "org_roles_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_concepts" ADD CONSTRAINT "syllabus_concepts_syllabus_id_syllabi_id_fk" FOREIGN KEY ("syllabus_id") REFERENCES "public"."syllabi"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_concepts" ADD CONSTRAINT "syllabus_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_concepts" ADD CONSTRAINT "syllabus_concepts_curated_by_user_id_fk" FOREIGN KEY ("curated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_enrollments" ADD CONSTRAINT "syllabus_enrollments_syllabus_id_syllabi_id_fk" FOREIGN KEY ("syllabus_id") REFERENCES "public"."syllabi"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_enrollments" ADD CONSTRAINT "syllabus_enrollments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "syllabus_sources" ADD CONSTRAINT "syllabus_sources_syllabus_id_syllabi_id_fk" FOREIGN KEY ("syllabus_id") REFERENCES "public"."syllabi"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_codebases_org" ON "codebases" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_github_installations_org" ON "github_installations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_org_roles_org" ON "org_roles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_syllabi_org" ON "syllabi" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_syllabus_sources_syllabus" ON "syllabus_sources" USING btree ("syllabus_id");--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_role_id_org_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE set null ON UPDATE no action;