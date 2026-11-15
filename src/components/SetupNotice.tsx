export function SetupNotice() {
  return (
    <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 p-6 text-sm leading-6">
      <h2 className="mb-2 text-base font-semibold text-amber-200">Almost there</h2>
      <ol className="list-decimal space-y-1 pl-5 text-zinc-300">
        <li>
          Copy <code>.env.example</code> to <code>.env</code> and set <code>GITHUB_TOKEN</code>, <code>DATABASE_URL</code>{" "}
          and <code>CRON_SECRET</code>.
        </li>
        <li>
          Create the tables: <code>npm run db:migrate</code> (or preview with fake data: <code>npm run seed:demo</code>)
        </li>
        <li>
          Collect data: <code>npm run sync</code> (Vercel Cron does this daily once deployed).
        </li>
      </ol>
    </div>
  );
}
