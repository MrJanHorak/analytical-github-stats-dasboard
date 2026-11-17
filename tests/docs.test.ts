/**
 * Guards against documentation drift: CI fails if the README falls behind the code.
 * When one of these fails, update README.md in the same change.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("README stays in sync with the code", () => {
  it("documents every environment variable in .env.example", () => {
    const vars = [...read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]);
    expect(vars.length).toBeGreaterThan(5);
    const missing = vars.filter((v) => !readme.includes(`\`${v}\``));
    expect(missing, "Add these to the Configuration table in README.md").toEqual([]);
  });

  it("lists every environment variable the code reads in .env.example", () => {
    const used = new Set<string>();
    for (const f of walk(join(root, "src")).concat(walk(join(root, "scripts")))) {
      for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|env\.([A-Z][A-Z0-9_]+)/g)) {
        used.add(m[1] ?? m[2]);
      }
    }
    // Set by the platform or the screenshot tooling, not by users of the app
    for (const v of ["NODE_ENV", "BASE_URL", "CHROME_CHANNEL", "VERCEL_PROJECT_PRODUCTION_URL"]) used.delete(v);
    const example = read(".env.example");
    const missing = [...used].filter((v) => !example.includes(`${v}=`));
    expect(missing, "Add these to .env.example (and the README table)").toEqual([]);
  });

  it("documents every npm script", () => {
    const scripts = Object.keys(JSON.parse(read("package.json")).scripts);
    const missing = scripts.filter((s) => !readme.includes(`npm run ${s}`) && !readme.includes(`npm ${s}`));
    expect(missing, "Add these to the Scripts table in README.md").toEqual([]);
  });

  it("documents every API route", () => {
    const routes = walk(join(root, "src/app/api"))
      .filter((f) => f.endsWith("route.ts"))
      .map((f) =>
        "/" +
        relative(join(root, "src/app"), f)
          .replace(/\/route\.ts$/, "")
          .replace(/\[(\w+)\]/g, ":$1"),
      );
    expect(routes.length).toBeGreaterThan(2);
    const missing = routes.filter((r) => !readme.includes(`\`${r}\``));
    expect(missing, "Add these to the HTTP routes table in README.md").toEqual([]);
  });

  it("links only to images that exist", () => {
    const images = [...readme.matchAll(/(?:!\[[^\]]*\]\(|src=")(docs\/[^)"]+)/g)].map((m) => m[1]);
    expect(images.length).toBeGreaterThan(5);
    expect(images.filter((p) => !existsSync(join(root, p)))).toEqual([]);
  });

  it("every screenshot in docs/ is used in the README", () => {
    const files = readdirSync(join(root, "docs")).filter((f) => /\.(png|svg)$/.test(f));
    expect(files.filter((f) => !readme.includes(`docs/${f}`))).toEqual([]);
  });
});
