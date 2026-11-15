CREATE TABLE "fork_events" (
	"repo_id" bigint NOT NULL,
	"fork_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"owner" text NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fork_events_repo_id_fork_id_pk" PRIMARY KEY("repo_id","fork_id")
);
--> statement-breakpoint
CREATE TABLE "star_events" (
	"repo_id" bigint NOT NULL,
	"login" text NOT NULL,
	"starred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "star_events_repo_id_login_pk" PRIMARY KEY("repo_id","login")
);
--> statement-breakpoint
CREATE INDEX "fork_events_repo_time" ON "fork_events" USING btree ("repo_id","created_at");--> statement-breakpoint
CREATE INDEX "star_events_repo_time" ON "star_events" USING btree ("repo_id","starred_at");