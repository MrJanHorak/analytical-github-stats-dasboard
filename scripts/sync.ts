// Run the collector from the command line or a GitHub Actions schedule:
//   npm run sync
// No time budget here: the first run backfills full star/fork history in one go.
import "dotenv/config";
import { runSync } from "../src/lib/sync";

const started = Date.now();
runSync()
  .then((r) => {
    console.log(`Synced traffic for ${r.reposSynced} repos in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (r.codeStatsPending)
      console.log(`Lines of code not counted yet for ${r.codeStatsPending} repo(s) — the next sync picks them up.`);
    if (r.starHistoryUnavailable.length)
      console.log(
        `Star history not available from GitHub for ${r.starHistoryUnavailable.length} repo(s) (star counts still update): ${r.starHistoryUnavailable.join(", ")}`,
      );
    if (r.errors.length) {
      console.error(r.errors);
      process.exitCode = 1;
    }
    process.exit();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
