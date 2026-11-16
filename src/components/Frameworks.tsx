import Link from "next/link";

type Group = { category: string; frameworks: { name: string; repos: number; newest: string | null }[] };

/** Frameworks & tools across all repos, one row per category; each chip filters the repo table. */
export function FrameworksPanel({ groups, range, reposCounted }: { groups: Group[]; range: string; reposCounted: number }) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
      <h2 className="text-sm font-medium text-zinc-400">Frameworks &amp; tools</h2>
      <p className="mb-3 text-xs text-zinc-500">
        declared in package.json, requirements.txt, pyproject.toml, Gemfile, go.mod, Cargo.toml, … or found by config file ·
        repos using each · newest version · forks excluded · click to filter the table
      </p>
      {groups.length ? (
        <dl className="space-y-2.5">
          {groups.map((g) => (
            <div key={g.category} className="grid grid-cols-1 gap-1 sm:grid-cols-[9rem_1fr]">
              <dt className="pt-0.5 text-xs text-zinc-500">{g.category}</dt>
              <dd className="flex flex-wrap gap-1.5">
                {g.frameworks.map((f) => (
                  <Link
                    key={f.name}
                    href={`/?range=${range}&q=${encodeURIComponent(f.name)}#repos`}
                    className="group flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-sm hover:border-zinc-600"
                    title={`${f.repos} of ${reposCounted} repos${f.newest ? ` · newest ${f.newest}` : ""}`}
                  >
                    <span className="group-hover:text-accent">{f.name}</span>
                    {f.newest && <span className="text-[11px] text-zinc-500">{f.newest.split(".").slice(0, 2).join(".")}</span>}
                    <span className="rounded bg-zinc-800 px-1 text-[11px] tabular-nums text-zinc-400">{f.repos}</span>
                  </Link>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-zinc-500">Frameworks appear after the next sync (they&apos;re detected while counting lines).</p>
      )}
    </section>
  );
}

/** One repo's frameworks as compact tags. */
export function FrameworkTags({ frameworks }: { frameworks: { name: string; version: string | null }[] }) {
  if (!frameworks.length) return null;
  return (
    <ul className="mb-3 mt-2 flex flex-wrap gap-1.5">
      {frameworks.map((f) => (
        <li key={f.name} className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300">
          {f.name}
          {f.version && <span className="ml-1 text-zinc-500">{f.version}</span>}
        </li>
      ))}
    </ul>
  );
}
