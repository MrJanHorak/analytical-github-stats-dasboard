import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
  /**
   * Non-blank lines of code on the default branch, counted from the tarball (lock files, vendored,
   * generated, minified and non-code files excluded — see src/lib/loc.ts). Null = not counted (yet).
   */
  linesOfCode: integer("lines_of_code"),
  /** The pushed_at that languages + lines were last checked for; rechecked when the repo is pushed again. */
  codeStatsPushedAt: timestamp("code_stats_pushed_at", { withTimezone: true }),
  /** Default-branch commit the line count is for; a push to another branch doesn't trigger a recount. */
  locCommitSha: text("loc_commit_sha"),
});

/** Bytes per language (GitHub Linguist — skips vendored and generated files). Current state, replaced on refresh. */
export const repoLanguages = pgTable(
  "repo_languages",
  {
    repoId: repoId(),
    language: text("language").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.language] })],
);

/** Lines of code per language on the default branch (see repos.linesOfCode). Current state, replaced on recount. */
export const repoLoc = pgTable(
  "repo_loc",
  {
    repoId: repoId(),
    language: text("language").notNull(),
    files: integer("files").notNull(),
    lines: integer("lines").notNull(),
    nonBlank: integer("non_blank").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.language] })],
);

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

/**
 * GitHub's own 14-day totals as reported on `date`. Unlike summing daily uniques,
 * these uniques are deduplicated across the whole 14-day window.
 */
export const trafficWindows = pgTable(
  "traffic_windows",
  {
    repoId: repoId(),
    date: date("date").notNull(),
    views: integer("views").notNull(),
    viewUniques: integer("view_uniques").notNull(),
    clones: integer("clones").notNull(),
    cloneUniques: integer("clone_uniques").notNull(),
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

/** Things worth knowing about, detected after each sync (traffic spikes, star bursts, milestones). */
export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    repoId: repoId(),
    /** The day the event happened (UTC) */
    date: date("date").notNull(),
    /** views_spike | clones_spike | stars_burst | stars_milestone_<n> */
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    value: integer("value").notNull(),
    baseline: real("baseline"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("alerts_repo_date_kind").on(t.repoId, t.date, t.kind), index("alerts_date").on(t.date)],
);

/** User notes pinned to a date on a repo's charts, e.g. "posted on Hacker News". */
export const annotations = pgTable(
  "annotations",
  {
    id: serial("id").primaryKey(),
    repoId: repoId(),
    date: date("date").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("annotations_repo_date").on(t.repoId, t.date)],
);

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  reposSynced: integer("repos_synced").notNull().default(0),
  error: text("error"),
});
