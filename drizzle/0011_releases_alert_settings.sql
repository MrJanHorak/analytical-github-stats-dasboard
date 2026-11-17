CREATE TABLE "alert_settings" (
	"repo_id" bigint PRIMARY KEY NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"spike_factor" real,
	"min_views" integer,
	"min_clones" integer,
	"star_burst" integer,
	"milestones" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"repo_id" bigint NOT NULL,
	"release_id" bigint NOT NULL,
	"tag" text NOT NULL,
	"name" text,
	"published_at" timestamp with time zone NOT NULL,
	"prerelease" boolean NOT NULL,
	"url" text,
	CONSTRAINT "releases_repo_id_release_id_pk" PRIMARY KEY("repo_id","release_id")
);
--> statement-breakpoint
CREATE INDEX "releases_published_idx" ON "releases" USING btree ("published_at");