CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"value" integer NOT NULL,
	"baseline" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_repo_date_kind" ON "alerts" USING btree ("repo_id","date","kind");--> statement-breakpoint
CREATE INDEX "alerts_date" ON "alerts" USING btree ("date");--> statement-breakpoint
CREATE INDEX "annotations_repo_date" ON "annotations" USING btree ("repo_id","date");