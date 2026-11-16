"use client";

import { useEffect, useState } from "react";

/**
 * A timestamp in the viewer's own time zone and locale. The server can't know either, so it
 * renders a UTC fallback and the browser swaps in local time after hydration — no mismatch.
 */
export function LocalTime({ iso }: { iso: string }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    setLocal(new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  }, [iso]);
  return (
    <time dateTime={iso} title={iso}>
      {local ?? `${new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`}
    </time>
  );
}
