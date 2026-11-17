import Link from "next/link";
import { SyncNowButton } from "./SyncNowButton";

const SCREENS = [
  ["Traffic you'd otherwise lose", "GitHub deletes views, clones and referrers after 14 days. Synced daily and kept forever."],
  ["Every repo at a glance", "Stars, forks, releases, lines of code, frameworks, issues & PRs, CI and deployments — one table."],
  ["Your activity", "Contribution heatmap, streaks, the repos you work on most, follower growth."],
  ["Alerts", "Traffic spikes, star bursts and milestones, with per-repo thresholds."],
];

/** Signed out (App mode): what this is, and sign in. */
export function Landing({ error, notice }: { error?: string; notice?: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <div className="space-y-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your GitHub repos, analysed</h1>
        <p className="text-zinc-400">
          A free, open-source dashboard for the stats GitHub only shows for two weeks — and plenty it never shows at all.
        </p>
        {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>}
        <a
          href="/api/auth/signin"
          className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 font-medium text-zinc-900 hover:bg-zinc-200"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Sign in with GitHub
        </a>
        <p className="text-xs text-zinc-500">
          Read-only access, only to the repos you choose. <Link href="/privacy" className="underline hover:text-zinc-300">What&apos;s stored</Link>
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SCREENS.map(([title, text]) => (
          <div key={title} className="rounded-xl border border-zinc-800 p-4">
            <h2 className="text-sm font-medium">{title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Signed in, App not installed yet. */
export function InstallPrompt({ installUrl, login }: { installUrl: string; login: string }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-zinc-800 p-6">
      <h1 className="text-xl font-semibold">Welcome, {login} 👋</h1>
      <p className="text-sm text-zinc-400">
        One more step: install the GitHub App on the repositories you want tracked — all of them, or just a few. It only
        gets read access, and you can change the selection or remove it any time on GitHub.
      </p>
      <a href={installUrl} className="inline-block rounded-lg bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
        Install on GitHub →
      </a>
      <p className="text-xs text-zinc-500">
        After installing you&apos;ll come straight back here. Already installed it?{" "}
        <a href="/api/auth/signin?next=/" className="underline hover:text-zinc-300">
          Refresh your access
        </a>
        .
      </p>
    </div>
  );
}

/** Installed, nothing synced yet. */
export function FirstSync({ autoStart }: { autoStart: boolean }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-zinc-800 p-6">
      <h1 className="text-xl font-semibold">Collecting your stats</h1>
      <p className="text-sm text-zinc-400">
        The first sync reads traffic for every repo, then star history, lines of code, frameworks and your contributions.
        It takes a few minutes; anything left over is finished by the nightly sync.
      </p>
      <SyncNowButton autoStart={autoStart} />
    </div>
  );
}
