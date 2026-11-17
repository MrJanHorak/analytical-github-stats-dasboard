import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy · GitHub Repo Stats" };

/** Plain-language note on what the App reads and stores (sign-in mode). */
export default function Privacy() {
  return (
    <article className="mx-auto max-w-2xl space-y-4 text-sm leading-6 text-zinc-300">
      <h1 className="text-2xl font-semibold text-white">What&apos;s stored</h1>
      <p>
        This is a free, open-source dashboard (
        <a href="https://github.com/MrJanHorak/analytical-github-stats-dasboard" className="text-accent hover:underline">
          source
        </a>
        ). Signing in uses GitHub; the GitHub App you install gets <b>read-only</b> access to the repositories you choose and can
        never change them.
      </p>
      <h2 className="pt-2 text-base font-medium text-white">Stored, for the repos you connect</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Traffic GitHub reports (views, clones, referrers, popular pages) — counts only, no visitor identities exist.</li>
        <li>Stars, forks, releases, issue and pull-request metadata (titles, authors, dates), CI and deployment results.</li>
        <li>Code statistics: line counts per language, detected frameworks, test and TODO counts. Source code is read to count it but never stored.</li>
        <li>Your public contribution counts and follower numbers.</li>
        <li>Your GitHub login, name, avatar and (if public) email, and an encrypted token so the nightly sync can read your contributions.</li>
      </ul>
      <h2 className="pt-2 text-base font-medium text-white">Who can see it</h2>
      <p>
        Only you, while signed in — plus other members of an organization you installed the App on. Public repos can also have
        public badges (stars, views) if you embed them. Nothing is sold or shared.
      </p>
      <h2 className="pt-2 text-base font-medium text-white">Leaving</h2>
      <p>
        Uninstall the App on GitHub, then use <Link href="/account" className="text-accent hover:underline">Delete my data</Link>{" "}
        on your account page to remove everything stored about your account.
      </p>
    </article>
  );
}
