CREATE TABLE "issues" (
	"repo_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"is_pr" boolean NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"author_association" text NOT NULL,
	"is_bot" boolean NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"merged_at" timestamp with time zone,
	CONSTRAINT "issues_repo_id_number_pk" PRIMARY KEY("repo_id","number")
);
--> statement-breakpoint
CREATE TABLE "repo_health" (
	"repo_id" bigint PRIMARY KEY NOT NULL,
	"health_percentage" integer,
	"has_readme" boolean,
	"has_license" boolean,
	"has_code_of_conduct" boolean,
	"has_contributing" boolean,
	"has_issue_template" boolean,
	"has_pr_template" boolean,
	"has_description" boolean,
	"health_checked_at" timestamp with time zone,
	"dependabot_critical" integer,
	"dependabot_high" integer,
	"dependabot_medium" integer,
	"dependabot_low" integer,
	"actions_available" boolean,
	"issues_synced_at" timestamp with time zone,
	"runs_synced_at" timestamp with time zone,
	"activity_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"repo_id" bigint NOT NULL,
	"run_id" bigint NOT NULL,
	"workflow" text NOT NULL,
	"event" text NOT NULL,
	"branch" text,
	"status" text NOT NULL,
	"conclusion" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_runs_repo_id_run_id_pk" PRIMARY KEY("repo_id","run_id")
);
--> statement-breakpoint
CREATE INDEX "issues_created_idx" ON "issues" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_created_idx" ON "workflow_runs" USING btree ("created_at");