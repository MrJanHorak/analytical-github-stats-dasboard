CREATE TABLE "repo_languages" (
	"repo_id" bigint NOT NULL,
	"language" text NOT NULL,
	"bytes" bigint NOT NULL,
	CONSTRAINT "repo_languages_repo_id_language_pk" PRIMARY KEY("repo_id","language")
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "lines_of_code" integer;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "code_stats_pushed_at" timestamp with time zone;