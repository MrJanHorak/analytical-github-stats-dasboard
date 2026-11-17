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
  /** Non-blank lines in test files (part of linesOfCode) */
  testLines: integer("test_lines"),
  /** TODO / FIXME / HACK markers in counted code */
  todoCount: integer("todo_count"),
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

/** Frameworks & tools detected from the default branch's manifests/config files (replaced on recount). */
export const repoFrameworks = pgTable(
  "repo_frameworks",
  {
    repoId: repoId(),
    framework: text("framework").notNull(),
    category: text("category").notNull(),
    /** Declared version (highest across manifests), null when not pinned or detected from a config file */
    version: text("version"),
    /** Dependency that matched, for comparing with the latest release (npm / pypi only) */
    package: text("package"),
    ecosystem: text("ecosystem"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.framework] })],
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

// --- Your own activity (the token's user), for /me ----------------------------------------------

/** Daily contribution counts from GitHub's contribution calendar, back to account creation. */
export const contributionDays = pgTable(
  "contribution_days",
  {
    login: text("login").notNull(),
    date: date("date").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.login, t.date] })],
);

/** Contribution totals per calendar year (GitHub only answers one year per query). */
export const contributionYears = pgTable(
  "contribution_years",
  {
    login: text("login").notNull(),
    year: integer("year").notNull(),
    commits: integer("commits").notNull(),
    pullRequests: integer("pull_requests").notNull(),
    issues: integer("issues").notNull(),
    reviews: integer("reviews").notNull(),
    reposWithCommits: integer("repos_with_commits").notNull(),
    /** Contributions in private repos the token can't see (counted, not itemised) */
    restricted: integer("restricted").notNull(),
    total: integer("total").notNull(),
    /** A year is final once it has been synced after it ended */
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.login, t.year] })],
);

/** Commits and pull requests per repository per year (any repo you contributed to, not just your own). */
export const contributionRepos = pgTable(
  "contribution_repos",
  {
    login: text("login").notNull(),
    year: integer("year").notNull(),
    repo: text("repo").notNull(), // owner/name
    commits: integer("commits").notNull(),
    pullRequests: integer("pull_requests").notNull(),
  },
  (t) => [primaryKey({ columns: [t.login, t.year, t.repo] })],
);

/** Daily followers / following snapshot → growth chart. */
export const profileSnapshots = pgTable(
  "profile_snapshots",
  {
    login: text("login").notNull(),
    date: date("date").notNull(),
    followers: integer("followers").notNull(),
    following: integer("following").notNull(),
    publicRepos: integer("public_repos").notNull(),
  },
  (t) => [primaryKey({ columns: [t.login, t.date] })],
);

// --- Repo activity (M3.7) ------------------------------------------------------------------------

/** Issues and pull requests (incrementally synced; GitHub's issues list includes PRs). */
export const issues = pgTable(
  "issues",
  {
    repoId: repoId(),
    number: integer("number").notNull(),
    isPr: boolean("is_pr").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    /** OWNER / MEMBER / COLLABORATOR = you and your team; anything else = outside contributor */
    authorAssociation: text("author_association").notNull(),
    isBot: boolean("is_bot").notNull(),
    state: text("state").notNull(), // open | closed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.number] }), index("issues_created_idx").on(t.createdAt)],
);

/** GitHub Actions workflow runs (first sync: the last 90 days; then incremental). */
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    repoId: repoId(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    workflow: text("workflow").notNull(),
    event: text("event").notNull(),
    branch: text("branch"),
    status: text("status").notNull(),
    conclusion: text("conclusion"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.runId] }), index("workflow_runs_created_idx").on(t.createdAt)],
);

/**
 * Current community health + open Dependabot alerts per repo, plus the activity sync's markers.
 * Null health = GitHub has no community profile for the repo (private). Null Dependabot = no
 * permission or alerts disabled. actions_available = false when the token can't read Actions.
 */
export const repoHealth = pgTable("repo_health", {
  repoId: repoId().primaryKey(),
  healthPercentage: integer("health_percentage"),
  hasReadme: boolean("has_readme"),
  hasLicense: boolean("has_license"),
  hasCodeOfConduct: boolean("has_code_of_conduct"),
  hasContributing: boolean("has_contributing"),
  hasIssueTemplate: boolean("has_issue_template"),
  hasPrTemplate: boolean("has_pr_template"),
  hasDescription: boolean("has_description"),
  healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
  dependabotCritical: integer("dependabot_critical"),
  dependabotHigh: integer("dependabot_high"),
  dependabotMedium: integer("dependabot_medium"),
  dependabotLow: integer("dependabot_low"),
  actionsAvailable: boolean("actions_available"),
  /** false when the token can't read deployments (Deployments: Read-only) */
  deploymentsAvailable: boolean("deployments_available"),
  deploymentsSyncedAt: timestamp("deployments_synced_at", { withTimezone: true }),
  /** false when the token can't read issues/PRs (private repos need Issues + Pull requests: Read-only) */
  issuesAvailable: boolean("issues_available"),
  issuesSyncedAt: timestamp("issues_synced_at", { withTimezone: true }),
  runsSyncedAt: timestamp("runs_synced_at", { withTimezone: true }),
  activitySyncedAt: timestamp("activity_synced_at", { withTimezone: true }),
});

// --- Code health (M3.9) -------------------------------------------------------------------------

/** One row per repo per day a recount happened: lines over time (history starts with this feature). */
export const codeSnapshots = pgTable(
  "code_snapshots",
  {
    repoId: repoId(),
    date: date("date").notNull(),
    linesOfCode: integer("lines_of_code").notNull(),
    testLines: integer("test_lines").notNull(),
    todoCount: integer("todo_count").notNull(),
    commitSha: text("commit_sha"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.date] })],
);

/** Deployments reported to GitHub (Vercel, Netlify, GitHub Pages, Actions environments, …). */
export const deployments = pgTable(
  "deployments",
  {
    repoId: repoId(),
    deploymentId: bigint("deployment_id", { mode: "number" }).notNull(),
    environment: text("environment").notNull(),
    /** Production-like environment (production / prod / github-pages / main) */
    production: boolean("production").notNull(),
    ref: text("ref"),
    creator: text("creator"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** Latest status (success, failure, error, inactive, in_progress, …); null until fetched */
    state: text("state"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.deploymentId] }), index("deployments_created_idx").on(t.createdAt)],
);

/** Latest released version of packages your frameworks come from (npm / PyPI), refreshed daily. */
export const packageVersions = pgTable(
  "package_versions",
  {
    ecosystem: text("ecosystem").notNull(),
    package: text("package").notNull(),
    latest: text("latest"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ecosystem, t.package] })],
);

// --- Releases & per-repo alert settings (M4a) ----------------------------------------------------

/** Published GitHub releases (drafts left out) — chart markers and a releases list. Replaced each sync. */
export const releases = pgTable(
  "releases",
  {
    repoId: repoId(),
    releaseId: bigint("release_id", { mode: "number" }).notNull(),
    tag: text("tag").notNull(),
    name: text("name"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    prerelease: boolean("prerelease").notNull(),
    url: text("url"),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.releaseId] }), index("releases_published_idx").on(t.publishedAt)],
);

/**
 * Per-repo alert overrides. Null fields fall back to the global ALERT_* settings; `muted` turns all
 * of a repo's alerts off, `milestones` just the star-milestone ones.
 */
export const alertSettings = pgTable("alert_settings", {
  repoId: repoId().primaryKey(),
  muted: boolean("muted").notNull().default(false),
  spikeFactor: real("spike_factor"),
  minViews: integer("min_views"),
  minClones: integer("min_clones"),
  starBurst: integer("star_burst"),
  milestones: boolean("milestones").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
