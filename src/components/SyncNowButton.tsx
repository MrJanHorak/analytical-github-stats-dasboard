"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Runs POST /api/sync/me (App mode) and refreshes the page when it's done. */
export function SyncNowButton({ autoStart = false, label = "Sync now" }: { autoStart?: boolean; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const started = useRef(false);

  async function run() {
    if (started.current && state === "running") return;
    started.current = true;
    setState("running");
    setMessage("");
    try {
      const res = await fetch("/api/sync/me", { method: "POST" });
      const body = (await res.json()) as { error?: string; message?: string; synced?: number };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState("done");
      setMessage(body.message ?? "Done — loading your stats…");
      router.refresh();
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "Sync failed");
    }
  }

  useEffect(() => {
    if (autoStart && !started.current) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={run}
        disabled={state === "running"}
        className="rounded-lg bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60"
      >
        {state === "running" ? "Syncing… (a few minutes)" : label}
      </button>
      {message && <span className={`text-sm ${state === "error" ? "text-red-400" : "text-zinc-400"}`}>{message}</span>}
    </div>
  );
}
