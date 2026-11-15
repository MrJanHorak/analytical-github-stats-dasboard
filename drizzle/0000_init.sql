CREATE TABLE "popular_paths" (
	"repo_id" bigint NOT NULL,
	"date" date NOT NULL,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"count" integer NOT NULL,
	"uniques" integer NOT NULL,
	CONSTRAINT "popular_paths_repo_id_date_path_pk" PRIMARY KEY("repo_id","date","path")
);
--> statement-breakpoint
CREATE TABLE "referrers" (
	"repo_id" bigint NOT NULL,
	"date" date NOT NULL,
	"referrer" text NOT NULL,
	"count" integer NOT NULL,
	"uniques" integer NOT NULL,
	CONSTRAINT "referrers_repo_id_date_referrer_pk" PRIMARY KEY("repo_id","date","referrer")
);
--> statement-breakpoint
CREATE TABLE "release_assets" (
	"repo_id" bigint NOT NULL,
	"date" date NOT NULL,
	"asset_id" bigint NOT NULL,
	"release_tag" text NOT NULL,
	"asset_name" text NOT NULL,
	"downloads" integer NOT NULL,
	CONSTRAINT "release_assets_repo_id_date_asset_id_pk" PRIMARY KEY("repo_id","date","asset_id")
);
--> statement-breakpoint
CREATE TABLE "repo_snapshots" (
	"repo_id" bigint NOT NULL,
	"date" date NOT NULL,
	"stars" integer NOT NULL,
	"forks" integer NOT NULL,
	"watchers" integer NOT NULL,
	"open_issues" integer NOT NULL,
	"size_kb" integer NOT NULL,
	CONSTRAINT "repo_snapshots_repo_id_date_pk" PRIMARY KEY("repo_id","date")
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" bigint PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"description" text,
	"private" boolean DEFAULT false NOT NULL,
	"fork" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"language" text,
	"html_url" text NOT NULL,
	"created_at" timestamp with time zone,
	"pushed_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	CONSTRAINT "repos_full_name_unique" UNIQUE("full_name")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"repos_synced" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "traffic_daily" (
	"repo_id" bigint NOT NULL,
	"date" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"view_uniques" integer DEFAULT 0 NOT NULL,
	"clones" integer DEFAULT 0 NOT NULL,
	"clone_uniques" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "traffic_daily_repo_id_date_pk" PRIMARY KEY("repo_id","date")
);
