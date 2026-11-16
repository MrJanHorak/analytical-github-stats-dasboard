CREATE TABLE "contribution_days" (
	"login" text NOT NULL,
	"date" date NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "contribution_days_login_date_pk" PRIMARY KEY("login","date")
);
--> statement-breakpoint
CREATE TABLE "contribution_repos" (
	"login" text NOT NULL,
	"year" integer NOT NULL,
	"repo" text NOT NULL,
	"commits" integer NOT NULL,
	"pull_requests" integer NOT NULL,
	CONSTRAINT "contribution_repos_login_year_repo_pk" PRIMARY KEY("login","year","repo")
);
--> statement-breakpoint
CREATE TABLE "contribution_years" (
	"login" text NOT NULL,
	"year" integer NOT NULL,
	"commits" integer NOT NULL,
	"pull_requests" integer NOT NULL,
	"issues" integer NOT NULL,
	"reviews" integer NOT NULL,
	"repos_with_commits" integer NOT NULL,
	"restricted" integer NOT NULL,
	"total" integer NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contribution_years_login_year_pk" PRIMARY KEY("login","year")
);
--> statement-breakpoint
CREATE TABLE "profile_snapshots" (
	"login" text NOT NULL,
	"date" date NOT NULL,
	"followers" integer NOT NULL,
	"following" integer NOT NULL,
	"public_repos" integer NOT NULL,
	CONSTRAINT "profile_snapshots_login_date_pk" PRIMARY KEY("login","date")
);
