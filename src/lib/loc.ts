import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";
import { detectFrameworks, isConfigSignal, manifestKind, parseManifest, type DetectedFramework } from "./frameworks";

/**
 * Lines-of-code counting from a repository tarball, streamed (never written to disk).
 *
 * Counted: files whose extension (or name) maps to a programming/markup language below.
 * Not counted: prose and data formats (Markdown, JSON, YAML, …), lock files, vendored and
 * build-output directories, minified files and source maps, binaries, files over 1 MB,
 * and anything a repo's `.gitattributes` marks `linguist-generated`, `linguist-vendored`
 * or `linguist-documentation`. `.gitattributes` can also opt files back in
 * (`-linguist-vendored`, `linguist-generated=false`) or override the language
 * (`linguist-language=Go`).
 */

export const MAX_FILE_BYTES = 1024 * 1024;
/** Average line length above this means minified/generated, not hand-written code. */
const MAX_AVG_LINE_LENGTH = 300;

const LOCK_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "deno.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "packages.lock.json",
  "flake.lock",
]);

/** Directory names treated as vendored or build output at any depth. */
const SKIP_DIRS = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "third_party",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "target",
]);

const EXT_LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  vue: "Vue", svelte: "Svelte", astro: "Astro",
  html: "HTML", htm: "HTML",
  css: "CSS", scss: "SCSS", sass: "Sass", less: "Less",
  py: "Python", pyi: "Python",
  rb: "Ruby", erb: "HTML+ERB",
  php: "PHP",
  java: "Java", kt: "Kotlin", kts: "Kotlin", scala: "Scala", groovy: "Groovy", gradle: "Groovy",
  go: "Go", rs: "Rust", swift: "Swift", dart: "Dart",
  c: "C", h: "C", cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++", hh: "C++", hxx: "C++",
  cs: "C#", fs: "F#", vb: "Visual Basic .NET",
  m: "Objective-C", mm: "Objective-C++",
  sh: "Shell", bash: "Shell", zsh: "Shell", fish: "Shell", ps1: "PowerShell", bat: "Batchfile", cmd: "Batchfile",
  sql: "SQL", graphql: "GraphQL", gql: "GraphQL", prisma: "Prisma",
  lua: "Lua", pl: "Perl", pm: "Perl", r: "R", jl: "Julia",
  ex: "Elixir", exs: "Elixir", erl: "Erlang", hs: "Haskell", elm: "Elm", clj: "Clojure", cljs: "Clojure",
  ml: "OCaml", zig: "Zig", nim: "Nim", sol: "Solidity",
  glsl: "GLSL", vert: "GLSL", frag: "GLSL", wgsl: "WGSL", hlsl: "HLSL",
  tf: "HCL", hcl: "HCL", nix: "Nix",
  ino: "C++", scad: "OpenSCAD", gd: "GDScript",
};

const NAME_LANG: Record<string, string> = {
  Dockerfile: "Dockerfile",
  Makefile: "Makefile",
  makefile: "Makefile",
  GNUmakefile: "Makefile",
  Rakefile: "Ruby",
  Gemfile: "Ruby",
  Jenkinsfile: "Groovy",
  Justfile: "Just",
  justfile: "Just",
};

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Language for a path, or null when it isn't counted as code. */
export function languageForPath(path: string): string | null {
  const name = basename(path);
  if (NAME_LANG[name]) return NAME_LANG[name];
  if (name.startsWith("Dockerfile.")) return "Dockerfile";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return EXT_LANG[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Why a path is skipped by default (before .gitattributes), or null if it is counted. */
export function defaultSkipReason(path: string): "lockfile" | "vendored" | "minified" | null {
  const name = basename(path);
  if (LOCK_FILES.has(name)) return "lockfile";
  if (/\.min\.(js|css|mjs)$/i.test(name) || /[.-]bundle\.js$/i.test(name) || name.endsWith(".map")) return "minified";
  const dirs = path.split("/").slice(0, -1);
  if (dirs.some((d) => SKIP_DIRS.has(d))) return "vendored";
  return null;
}

/** Total lines and non-blank lines, or null for binary / minified content. */
export function countLines(buf: Buffer): { lines: number; nonBlank: number } | null {
  const sniff = Math.min(buf.length, 8000);
  for (let i = 0; i < sniff; i++) if (buf[i] === 0) return null;
  let lines = 0;
  let nonBlank = 0;
  let content = false;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 10) {
      lines++;
      if (content) nonBlank++;
      content = false;
    } else if (!content && b !== 32 && b !== 9 && b !== 13 && b !== 12 && b !== 11) {
      content = true;
    }
  }
  if (buf.length && buf[buf.length - 1] !== 10) {
    lines++;
    if (content) nonBlank++;
  }
  if (lines && buf.length / lines > MAX_AVG_LINE_LENGTH) return null;
  return { lines, nonBlank };
}

// ---------------------------------------------------------------------------------------------
// .gitattributes

type AttrValue = boolean | string;
export type AttrRule = { dir: string; re: RegExp; attrs: Record<string, AttrValue> };

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        out += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

/**
 * Parse one `.gitattributes` file located in `dir` ("" for the repo root).
 * Only linguist-* attributes are kept. Lenient on purpose: `dir/` and `dir/*` cover the
 * whole subtree, which is what people writing `vendor/* linguist-vendored` mean.
 */
export function parseGitattributes(text: string, dir = ""): AttrRule[] {
  const rules: AttrRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...parts] = line.split(/\s+/);
    const attrs: Record<string, AttrValue> = {};
    for (const p of parts) {
      const m = /^([-!]?)(linguist-[a-z-]+)(?:=(.*))?$/.exec(p);
      if (!m) continue;
      const [, prefix, key, value] = m;
      if (prefix) attrs[key] = false;
      else if (value === undefined || value === "true") attrs[key] = true;
      else if (value === "false") attrs[key] = false;
      else attrs[key] = value;
    }
    if (!Object.keys(attrs).length) continue;

    let pat = pattern;
    if (pat.endsWith("/")) pat += "**";
    else if (pat.endsWith("/*")) pat = pat.slice(0, -1) + "**";
    const anchored = pat.includes("/");
    if (pat.startsWith("/")) pat = pat.slice(1);
    const body = globToRegex(pat);
    rules.push({ dir, re: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`), attrs });
  }
  return rules;
}

/** Attributes for a path: rules from shallower files first, later lines win. */
export function attributesFor(path: string, rules: AttrRule[]): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  const applicable = rules.filter((r) => r.dir === "" || path.startsWith(r.dir + "/"));
  const depth = (d: string) => (d ? d.split("/").length : 0);
  applicable.sort((a, b) => depth(a.dir) - depth(b.dir));
  for (const r of applicable) {
    const rel = r.dir ? path.slice(r.dir.length + 1) : path;
    if (r.re.test(rel)) Object.assign(out, r.attrs);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Summaries

export type CountedFile = { path: string; language: string; lines: number; nonBlank: number };
export type LanguageLoc = { language: string; files: number; lines: number; nonBlank: number };
export type LocSummary = {
  /** Non-blank lines across counted files — the headline "lines of code" number. */
  nonBlank: number;
  lines: number;
  files: number;
  languages: LanguageLoc[];
  /** Frameworks and tools from dependency manifests and config files (see src/lib/frameworks.ts) */
  frameworks: DetectedFramework[];
};

/** Apply default skip rules and .gitattributes, then total per language (largest first). */
export function summarize(files: CountedFile[], rules: AttrRule[]): LocSummary {
  const by = new Map<string, LanguageLoc>();
  for (const f of files) {
    const attrs = rules.length ? attributesFor(f.path, rules) : {};
    if (attrs["linguist-generated"] === true || attrs["linguist-documentation"] === true) continue;
    const reason = defaultSkipReason(f.path);
    if (attrs["linguist-vendored"] === true) continue;
    if (reason === "lockfile" || reason === "minified") continue;
    if (reason === "vendored" && attrs["linguist-vendored"] !== false && attrs["linguist-generated"] !== false) continue;
    const language = typeof attrs["linguist-language"] === "string" ? attrs["linguist-language"] : f.language;
    const cur = by.get(language) ?? { language, files: 0, lines: 0, nonBlank: 0 };
    cur.files++;
    cur.lines += f.lines;
    cur.nonBlank += f.nonBlank;
    by.set(language, cur);
  }
  const languages = [...by.values()].sort((a, b) => b.nonBlank - a.nonBlank || a.language.localeCompare(b.language));
  return {
    frameworks: [],
    nonBlank: languages.reduce((a, l) => a + l.nonBlank, 0),
    lines: languages.reduce((a, l) => a + l.lines, 0),
    files: languages.reduce((a, l) => a + l.files, 0),
    languages,
  };
}

/**
 * Count lines in a gzipped tarball as GitHub serves it (`/repos/{o}/{r}/tarball/{ref}`:
 * every path is prefixed with one `owner-repo-sha/` directory, which is stripped).
 */
export async function countTarball(gzipped: Readable): Promise<LocSummary> {
  const files: CountedFile[] = [];
  const rules: AttrRule[] = [];
  const manifests: { kind: NonNullable<ReturnType<typeof manifestKind>>; deps: Map<string, string | null> }[] = [];
  const configPaths: string[] = [];
  const tar = extract();

  tar.on("entry", (header, stream, next) => {
    const done = () => next();
    const full = header.name.replace(/^\.\//, "");
    const path = full.includes("/") ? full.slice(full.indexOf("/") + 1) : "";
    const name = basename(path);
    const isAttrs = name === ".gitattributes";
    const language = header.type === "file" && path ? languageForPath(path) : null;
    const size = header.size ?? 0;
    const skip = defaultSkipReason(path);
    // Manifests and config files outside vendored/build dirs feed framework detection
    const manifest = header.type === "file" && path && skip !== "vendored" ? manifestKind(path) : null;
    if (header.type === "file" && path && skip !== "vendored" && isConfigSignal(path)) configPaths.push(path);

    if ((!language && !isAttrs && !manifest) || size > MAX_FILE_BYTES || skip === "lockfile") {
      stream.on("end", done);
      stream.resume();
      return;
    }
    const chunks: Buffer[] = [];
    stream.on("data", (c: unknown) => void chunks.push(c as Buffer));
    stream.on("end", () => {
      const buf = Buffer.concat(chunks);
      if (manifest) manifests.push({ kind: manifest, deps: parseManifest(manifest, buf.toString("utf8")) });
      if (isAttrs) rules.push(...parseGitattributes(buf.toString("utf8"), dirname(path)));
      else if (language) {
        const counted = countLines(buf);
        if (counted) files.push({ path, language, ...counted });
      }
      done();
    });
  });

  await pipeline(gzipped, createGunzip(), tar);
  return { ...summarize(files, rules), frameworks: detectFrameworks(manifests, configPaths) };
}
