CREATE TABLE "traffic_windows" (
	"repo_id" bigint NOT NULL,
	"date" date NOT NULL,
	"views" integer NOT NULL,
	"view_uniques" integer NOT NULL,
	"clones" integer NOT NULL,
	"clone_uniques" integer NOT NULL,
	CONSTRAINT "traffic_windows_repo_id_date_pk" PRIMARY KEY("repo_id","date")
);
