CREATE TABLE "code_snapshots" (
	"repo_id" bigint NOT NULL,
	"date" date NOT NULL,
	"lines_of_code" integer NOT NULL,
	"test_lines" integer NOT NULL,
	"todo_count" integer NOT NULL,
	"commit_sha" text,
	CONSTRAINT "code_snapshots_repo_id_date_pk" PRIMARY KEY("repo_id","date")
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"repo_id" bigint NOT NULL,
	"deployment_id" bigint NOT NULL,
	"environment" text NOT NULL,
	"production" boolean NOT NULL,
	"ref" text,
	"creator" text,
	"created_at" timestamp with time zone NOT NULL,
	"state" text,
	CONSTRAINT "deployments_repo_id_deployment_id_pk" PRIMARY KEY("repo_id","deployment_id")
);
--> statement-breakpoint
CREATE TABLE "package_versions" (
	"ecosystem" text NOT NULL,
	"package" text NOT NULL,
	"latest" text,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "package_versions_ecosystem_package_pk" PRIMARY KEY("ecosystem","package")
);
--> statement-breakpoint
ALTER TABLE "repo_frameworks" ADD COLUMN "package" text;--> statement-breakpoint
ALTER TABLE "repo_frameworks" ADD COLUMN "ecosystem" text;--> statement-breakpoint
ALTER TABLE "repo_health" ADD COLUMN "deployments_available" boolean;--> statement-breakpoint
ALTER TABLE "repo_health" ADD COLUMN "deployments_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "test_lines" integer;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "todo_count" integer;--> statement-breakpoint
CREATE INDEX "deployments_created_idx" ON "deployments" USING btree ("created_at");--> statement-breakpoint
-- Recount every repo once so test lines, TODOs and framework packages are filled in.
UPDATE "repos" SET "loc_commit_sha" = NULL, "code_stats_pushed_at" = NULL;
