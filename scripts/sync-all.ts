// The App-mode (multi-user) sync, meant for the scheduled GitHub Actions workflow:
//   npm run sync:all
// Lists every installation of the GitHub App and syncs each one with its own installation token,
// then judges alerts once. No time budget: the first run for a new user backfills everything.
// Needs GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET,
// AUTH_SECRET and DATABASE_URL. Without them, use `npm run sync` (single-user, personal token).
import "dotenv/config";
import { isAppMode } from "../src/lib/app-mode";
import { syncAllInstallations } from "../src/lib/sync-app";

if (!isAppMode()) {
  console.error("GitHub App settings are missing — set the GITHUB_APP_* variables and AUTH_SECRET, or run `npm run sync`.");
  process.exit(1);
}

const started = Date.now();
syncAllInstallations()
  .then((r) => {
    let failed = false;
    for (const i of r.installations) {
      if (i.error) {
        failed = true;
        console.error(`✗ ${i.installation}: ${i.error}`);
        continue;
      }
      const res = i.result!;
      console.log(`✓ ${i.installation}: ${res.reposSynced} repos${res.errors.length ? `, ${res.errors.length} error(s)` : ""}`);
      if (res.errors.length) {
        failed = true;
        console.error(res.errors);
      }
    }
    console.log(`${r.installations.length} installation(s), ${r.alertsCreated} new alert(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (r.alertsError) {
      failed = true;
      console.error(`alerts: ${r.alertsError}`);
    }
    process.exit(failed ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
