import { fmt } from "@/lib/utils";

// GitHub's colors for common languages; anything else uses the accent color.
const COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Shell: "#89e051",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  "Jupyter Notebook": "#DA5B0B",
  Dockerfile: "#384d54",
  Other: "#6e7681",
};

export const languageColor = (lang: string) => COLORS[lang] ?? "var(--color-accent, #2f81f7)";

type Item = { language: string; bytes: number; repos?: number };

/** Stacked bar plus one row per language with its share of bytes (and repo count when given). */
export function LanguageBars({ items }: { items: Item[] }) {
  const total = items.reduce((a, i) => a + i.bytes, 0);
  if (!total) return null;
  const pct = (b: number) => (b / total) * 100;
  return (
    <div>
      <div className="mb-3 flex h-2 overflow-hidden rounded bg-zinc-800">
        {items.map((i) => (
          <div key={i.language} title={i.language} style={{ width: `${pct(i.bytes)}%`, background: languageColor(i.language) }} />
        ))}
      </div>
      <ul className="space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i.language} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: languageColor(i.language) }} />
            <span className="min-w-0 flex-1 truncate">{i.language}</span>
            {i.repos !== undefined && <span className="text-xs text-zinc-500">{fmt(i.repos)} repo{i.repos === 1 ? "" : "s"}</span>}
            <span className="w-14 text-right tabular-nums text-zinc-400">{pct(i.bytes).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
