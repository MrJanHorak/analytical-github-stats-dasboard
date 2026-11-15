import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const repoId = () => bigint("repo_id", { mode: "number" }).notNull();

export const repos = pgTable("repos", {
  id: bigint("id", { mode: "number" }).primaryKey(), // GitHub repo id
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull().unique(),
  description: text("description"),
  isPrivate: boolean("private").notNull().default(false),
  isFork: boolean("fork").notNull().default(false),
  isArchived: boolean("archived").notNull().default(false),
  language: text("language"),
  htmlUrl: text("html_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

export const repoSnapshots = pgTable(
  "repo_snapshots",
  {
    repoId: repoId(),
    date: date("date").notNull(),
    stars: integer("stars").notNull(),
    forks: integer("forks").notNull(),
    watchers: integer("watchers").notNull(),
    openIssues: integer("open_issues").notNull(),
    sizeKb: integer("size_kb").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.date] })],
);

export const trafficDaily = pgTable(
  "traffic_daily",
  {
    repoId: repoId(),
    date: date("date").notNull(),
    views: integer("views").notNull().default(0),
    viewUniques: integer("view_uniques").notNull().default(0),
    clones: integer("clones").notNull().default(0),
    cloneUniques: integer("clone_uniques").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.date] })],
);

/** Rolling 14-day top-10 referrers, as reported on `date`. */
export const referrers = pgTable(
  "referrers",
  {
    repoId: repoId(),
    date: date("date").notNull(),
    referrer: text("referrer").notNull(),
    count: integer("count").notNull(),
    uniques: integer("uniques").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.date, t.referrer] })],
);

/** Rolling 14-day top-10 content paths, as reported on `date`. */
export const popularPaths = pgTable(
  "popular_paths",
  {
    repoId: repoId(),
    date: date("date").notNull(),
    path: text("path").notNull(),
    title: text("title").notNull(),
    count: integer("count").notNull(),
    uniques: integer("uniques").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.date, t.path] })],
);

/** Cumulative download count per release asset, snapshotted daily. */
export const releaseAssets = pgTable(
  "release_assets",
  {
    repoId: repoId(),
    date: date("date").notNull(),
    assetId: bigint("asset_id", { mode: "number" }).notNull(),
    releaseTag: text("release_tag").notNull(),
    assetName: text("asset_name").notNull(),
    downloads: integer("downloads").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.date, t.assetId] })],
);

/** One row per current stargazer, with GitHub's starred_at — gives full star history. */
export const starEvents = pgTable(
  "star_events",
  {
    repoId: repoId(),
    login: text("login").notNull(),
    starredAt: timestamp("starred_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.login] }), index("star_events_repo_time").on(t.repoId, t.starredAt)],
);

/** One row per current fork, with its creation time — gives full fork history. */
export const forkEvents = pgTable(
  "fork_events",
  {
    repoId: repoId(),
    forkId: bigint("fork_id", { mode: "number" }).notNull(),
    fullName: text("full_name").notNull(),
    owner: text("owner").notNull(),
    stars: integer("stars").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.forkId] }), index("fork_events_repo_time").on(t.repoId, t.createdAt)],
);

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  reposSynced: integer("repos_synced").notNull().default(0),
  error: text("error"),
});
