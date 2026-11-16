type Defaults = { spikeFactor: number; minViews: number; minClones: number; starBurst: number };
type Override = {
  muted: boolean;
  milestones: boolean;
  spikeFactor: number | null;
  minViews: number | null;
  minClones: number | null;
  starBurst: number | null;
} | null;

const input =
  "w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm tabular-nums outline-none focus:border-accent placeholder:text-zinc-600";

/**
 * Per-repo alert thresholds. Blank fields use the global ALERT_* defaults (shown as placeholders).
 * Posts to a server action, so it sits behind the dashboard password like notes do.
 */
export function AlertSettingsForm({
  fullName,
  override,
  defaults,
  action,
}: {
  fullName: string;
  override: Override;
  defaults: Defaults;
  action: (formData: FormData) => Promise<void>;
}) {
  const summary = override?.muted
    ? "muted"
    : override
      ? "custom thresholds"
      : "using the defaults";
  return (
    <details className="group mt-4 rounded-lg border border-zinc-800 p-3 open:bg-zinc-900/40">
      <summary className="cursor-pointer select-none text-sm text-zinc-400 hover:text-zinc-200">
        Alert settings <span className="text-xs text-zinc-500">· {summary}</span>
      </summary>
      <form action={action} className="mt-3 space-y-3 text-sm">
        <input type="hidden" name="repo" value={fullName} />
        <label className="flex items-center gap-2">
          <input type="checkbox" name="muted" defaultChecked={override?.muted ?? false} className="accent-amber-500" />
          Mute all alerts for this repo
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="milestones" defaultChecked={override?.milestones ?? true} className="accent-emerald-500" />
          Star milestone alerts (10, 25, 50, 100, …)
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">Spike = this × the usual day</span>
            <input name="spikeFactor" type="number" step="0.1" min="1.1" max="100" defaultValue={override?.spikeFactor ?? ""} placeholder={String(defaults.spikeFactor)} className={input} />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">…and at least this many views</span>
            <input name="minViews" type="number" min="0" defaultValue={override?.minViews ?? ""} placeholder={String(defaults.minViews)} className={input} />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">…or this many clones</span>
            <input name="minClones" type="number" min="0" defaultValue={override?.minClones ?? ""} placeholder={String(defaults.minClones)} className={input} />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="text-zinc-400">Star burst: stars in one day</span>
            <input name="starBurst" type="number" min="1" defaultValue={override?.starBurst ?? ""} placeholder={String(defaults.starBurst)} className={input} />
          </label>
        </div>
        <p className="text-xs text-zinc-500">Blank = the global default (shown greyed). Applies from the next sync.</p>
        <div className="flex gap-2">
          <button className="rounded-md bg-zinc-800 px-3 py-1 hover:bg-zinc-700">Save</button>
          {override && (
            <button name="reset" value="1" className="rounded-md px-3 py-1 text-zinc-400 hover:text-zinc-200">
              Reset to defaults
            </button>
          )}
        </div>
      </form>
    </details>
  );
}
