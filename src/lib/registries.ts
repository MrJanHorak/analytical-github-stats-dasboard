/**
 * Latest released versions from public package registries (no auth). Used to flag frameworks a
 * repo declares at an older major version. No Next.js imports, so the CLI sync can use it.
 */

const TIMEOUT_MS = 10_000;

async function getJson(url: string): Promise<unknown | null> {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "github-repo-stats" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Latest stable version of a package, or null when the registry doesn't know it. */
export async function fetchLatestVersion(ecosystem: string, pkg: string): Promise<string | null> {
  if (ecosystem === "npm") {
    const data = (await getJson(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}/latest`)) as { version?: string } | null;
    return data?.version ?? null;
  }
  if (ecosystem === "pypi") {
    const data = (await getJson(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`)) as { info?: { version?: string } } | null;
    return data?.info?.version ?? null;
  }
  return null;
}

/** Ecosystems we can look up. */
export const CHECKABLE_ECOSYSTEMS = new Set(["npm", "pypi"]);
