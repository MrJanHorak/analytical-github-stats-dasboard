import { and, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { CHECKABLE_ECOSYSTEMS, fetchLatestVersion } from "./registries";
import { mapLimit } from "./utils";

const { repoFrameworks, packageVersions } = schema;

/** Latest versions are refreshed at most this often. */
const MAX_AGE_MS = 20 * 3_600_000;

/**
 * Look up the latest release of every package a detected framework came from (npm / PyPI), at
 * most once a day each. A few dozen distinct packages at most, so this is quick.
 */
export async function syncPackageVersions(opts: { now?: Date; outOfTime?: () => boolean } = {}) {
  const db = getDb();
  const now = opts.now ?? new Date();
  const [used, known] = await Promise.all([
    db
      .selectDistinct({ ecosystem: repoFrameworks.ecosystem, package: repoFrameworks.package })
      .from(repoFrameworks)
      .where(and(isNotNull(repoFrameworks.package), isNotNull(repoFrameworks.ecosystem))),
    db.select().from(packageVersions),
  ]);
  const checked = new Map(known.map((k) => [`${k.ecosystem}:${k.package}`, k.checkedAt.getTime()]));
  const due = used.filter(
    (u) => CHECKABLE_ECOSYSTEMS.has(u.ecosystem!) && now.getTime() - (checked.get(`${u.ecosystem}:${u.package}`) ?? 0) > MAX_AGE_MS,
  );
  const errors: string[] = [];
  let fetched = 0;
  await mapLimit(due, 8, async (u) => {
    if (opts.outOfTime?.()) return;
    let latest: string | null = null;
    try {
      latest = await fetchLatestVersion(u.ecosystem!, u.package!);
    } catch (e) {
      errors.push(`${u.package}: ${e instanceof Error ? e.message : String(e)}`);
      return; // retried next run
    }
    await db
      .insert(packageVersions)
      .values({ ecosystem: u.ecosystem!, package: u.package!, latest, checkedAt: now })
      .onConflictDoUpdate({
        target: [packageVersions.ecosystem, packageVersions.package],
        set: { latest: sql.raw("excluded.latest"), checkedAt: sql.raw("excluded.checked_at") },
      });
    fetched++;
  });
  return { fetched, errors };
}
