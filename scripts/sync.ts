// Run the collector from the command line or a GitHub Actions schedule:
//   npm run sync
import "dotenv/config";
import { runSync } from "../src/lib/sync";

runSync()
  .then((r) => {
    console.log(`Synced ${r.reposSynced} repos`);
    if (r.errors.length) {
      console.error(r.errors);
      process.exitCode = 1;
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
