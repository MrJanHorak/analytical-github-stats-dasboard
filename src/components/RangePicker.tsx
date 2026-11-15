import Link from "next/link";
import { RANGES, rangeLabel, rangeParam } from "@/lib/utils";

export function RangePicker({ current, basePath }: { current: number; basePath: string }) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-800 p-0.5 text-sm">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={`${basePath}?range=${rangeParam(r)}`}
          className={`rounded-md px-3 py-1 ${r === current ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"}`}
        >
          {rangeLabel(r)}
        </Link>
      ))}
    </div>
  );
}
