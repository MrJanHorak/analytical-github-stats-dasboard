import { getExportData } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { toCsv } from "@/lib/transform";
import { isoDay, parseRange, rangeParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** GET /api/export?kind=repos|daily&range=30|all → CSV download. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "daily" ? "daily" : "repos";
  const range = parseRange(url.searchParams.get("range") ?? undefined);
  const rows = await getExportData(kind, range, await getScope());
  const filename = `github-stats-${kind}-${rangeParam(range)}-${isoDay()}.csv`;
  return new Response(toCsv(rows as Record<string, unknown>[]), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
