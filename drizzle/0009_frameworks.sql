CREATE TABLE "repo_frameworks" (
	"repo_id" bigint NOT NULL,
	"framework" text NOT NULL,
	"category" text NOT NULL,
	"version" text,
	CONSTRAINT "repo_frameworks_repo_id_framework_pk" PRIMARY KEY("repo_id","framework")
);
--> statement-breakpoint
-- Recount every repo once so frameworks are detected (lines of code stay until replaced).
UPDATE "repos" SET "loc_commit_sha" = NULL, "code_stats_pushed_at" = NULL;
