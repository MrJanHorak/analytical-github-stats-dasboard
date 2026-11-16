CREATE TABLE "repo_loc" (
	"repo_id" bigint NOT NULL,
	"language" text NOT NULL,
	"files" integer NOT NULL,
	"lines" integer NOT NULL,
	"non_blank" integer NOT NULL,
	CONSTRAINT "repo_loc_repo_id_language_pk" PRIMARY KEY("repo_id","language")
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "loc_commit_sha" text;--> statement-breakpoint
-- Old values were additions-minus-deletions estimates; clear them so the next sync recounts from tarballs.
UPDATE "repos" SET "lines_of_code" = NULL, "code_stats_pushed_at" = NULL;
