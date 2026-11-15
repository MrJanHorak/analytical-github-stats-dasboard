import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // raise on Vercel Pro if you have many repos

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Leave headroom under maxDuration; unfinished star/fork backfills resume next run.
  const timeBudgetMs = Number(process.env.SYNC_TIME_BUDGET_MS ?? (maxDuration - 15) * 1000);
  const result = await runSync({ timeBudgetMs });
  return NextResponse.json(result, { status: result.errors.length ? 207 : 200 });
}
