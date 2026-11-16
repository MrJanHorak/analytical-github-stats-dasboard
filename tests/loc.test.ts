import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { describe, expect, it } from "vitest";
import {
  attributesFor,
  countLines,
  countTarball,
  defaultSkipReason,
  languageForPath,
  parseGitattributes,
  summarize,
} from "@/lib/loc";

describe("languageForPath", () => {
  it("maps extensions and well-known file names", () => {
    expect(languageForPath("src/app/page.tsx")).toBe("TypeScript");
    expect(languageForPath("lib/x.MJS")).toBe("JavaScript");
    expect(languageForPath("Dockerfile")).toBe("Dockerfile");
    expect(languageForPath("docker/Dockerfile.dev")).toBe("Dockerfile");
    expect(languageForPath("Makefile")).toBe("Makefile");
  });

  it("does not count prose, data or extensionless files", () => {
    expect(languageForPath("README.md")).toBeNull();
    expect(languageForPath("package.json")).toBeNull();
    expect(languageForPath(".github/workflows/ci.yml")).toBeNull();
    expect(languageForPath("LICENSE")).toBeNull();
    expect(languageForPath(".eslintrc")).toBeNull();
  });
});

describe("defaultSkipReason", () => {
  it("skips lock files, vendored/build dirs and minified files", () => {
    expect(defaultSkipReason("package-lock.json")).toBe("lockfile");
    expect(defaultSkipReason("apps/web/pnpm-lock.yaml")).toBe("lockfile");
    expect(defaultSkipReason("node_modules/react/index.js")).toBe("vendored");
    expect(defaultSkipReason("packages/a/dist/index.js")).toBe("vendored");
    expect(defaultSkipReason("public/jquery.min.js")).toBe("minified");
    expect(defaultSkipReason("app.js.map")).toBe("minified");
    expect(defaultSkipReason("src/build.ts")).toBeNull(); // a file named build is fine
    expect(defaultSkipReason("src/index.ts")).toBeNull();
  });
});

describe("countLines", () => {
  it("counts total and non-blank lines, with or without a trailing newline", () => {
    expect(countLines(Buffer.from("a\n\n  \nb\n"))).toEqual({ lines: 4, nonBlank: 2 });
    expect(countLines(Buffer.from("a\r\n\r\nb"))).toEqual({ lines: 3, nonBlank: 2 });
    expect(countLines(Buffer.from(""))).toEqual({ lines: 0, nonBlank: 0 });
  });

  it("rejects binary and minified content", () => {
    expect(countLines(Buffer.from([0x89, 0x50, 0x00, 0x47]))).toBeNull();
    expect(countLines(Buffer.from("x".repeat(5000) + "\n"))).toBeNull();
  });
});

describe("gitattributes", () => {
  it("parses linguist attributes in all their forms", () => {
    const rules = parseGitattributes(
      [
        "# comment",
        "* text=auto eol=lf",
        "src/gen/** linguist-generated",
        "legacy/* linguist-vendored=true",
        "dist/ -linguist-vendored",
        "*.inc linguist-language=PHP",
        "docs/** linguist-documentation",
      ].join("\n"),
    );
    expect(rules).toHaveLength(5); // the text=auto line has no linguist-* attribute
    expect(attributesFor("src/gen/api/client.ts", rules)).toEqual({ "linguist-generated": true });
    expect(attributesFor("legacy/deep/old.js", rules)).toEqual({ "linguist-vendored": true });
    expect(attributesFor("dist/index.js", rules)).toEqual({ "linguist-vendored": false });
    expect(attributesFor("lib/x.inc", rules)).toEqual({ "linguist-language": "PHP" });
    expect(attributesFor("src/app.ts", rules)).toEqual({});
  });

  it("scopes nested files to their directory, deeper files and later lines winning", () => {
    const rules = [
      ...parseGitattributes("*.ts linguist-generated", ""),
      ...parseGitattributes("*.ts -linguist-generated", "packages/core"),
    ];
    expect(attributesFor("packages/core/src/a.ts", rules)).toEqual({ "linguist-generated": false });
    expect(attributesFor("packages/web/a.ts", rules)).toEqual({ "linguist-generated": true });
    // Anchored patterns are relative to the file's directory
    const anchored = parseGitattributes("/gen.ts linguist-generated", "pkg");
    expect(attributesFor("pkg/gen.ts", anchored)).toEqual({ "linguist-generated": true });
    expect(attributesFor("pkg/sub/gen.ts", anchored)).toEqual({});
  });
});

describe("summarize", () => {
  const f = (path: string, language: string, nonBlank: number) => ({ path, language, lines: nonBlank + 1, nonBlank });

  it("totals per language, applying default skips and .gitattributes", () => {
    const files = [
      f("src/a.ts", "TypeScript", 100),
      f("src/b.ts", "TypeScript", 50),
      f("src/gen/client.ts", "TypeScript", 9000),
      f("src/styles.css", "CSS", 30),
      f("node_modules/x/index.js", "JavaScript", 5000),
      f("dist/lib.js", "JavaScript", 40), // vendored by default, opted back in below
      f("lib/legacy.inc", "C++", 10), // language overridden below
    ];
    const rules = parseGitattributes("src/gen/** linguist-generated\ndist/** -linguist-vendored\n*.inc linguist-language=PHP");
    const s = summarize(files, rules);
    expect(s.languages).toEqual([
      { language: "TypeScript", files: 2, lines: 152, nonBlank: 150 },
      { language: "JavaScript", files: 1, lines: 41, nonBlank: 40 },
      { language: "CSS", files: 1, lines: 31, nonBlank: 30 },
      { language: "PHP", files: 1, lines: 11, nonBlank: 10 },
    ]);
    expect(s.nonBlank).toBe(230);
    expect(s.files).toBe(5);
  });
});

async function tarball(entries: Record<string, string | Buffer>, root = "MrJanHorak-demo-abc1234") {
  const p = pack();
  p.entry({ name: `${root}/`, type: "directory" });
  for (const [name, body] of Object.entries(entries)) p.entry({ name: `${root}/${name}` }, body);
  p.finalize();
  const chunks: Buffer[] = [];
  for await (const c of p) chunks.push(c as Buffer);
  return Readable.from([gzipSync(Buffer.concat(chunks))]);
}

describe("countTarball", () => {
  it("streams a GitHub-style tarball and counts only real code", async () => {
    const s = await countTarball(
      await tarball({
        ".gitattributes": "generated/** linguist-generated\n",
        "README.md": "# Demo\n\nLots of prose\n",
        "package.json": '{\n  "name": "demo"\n}\n',
        "package-lock.json": '{\n"lockfileVersion": 3\n}\n'.repeat(500),
        "src/index.ts": "export const a = 1;\n\nexport const b = 2;\n",
        "src/App.tsx": "export function App() {\n  return null;\n}\n",
        "src/style.css": "body {\n  margin: 0;\n}\n",
        "generated/schema.ts": "export type X = 1;\n".repeat(200),
        "node_modules/lib/index.js": "module.exports = 1;\n".repeat(100),
        "public/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
        "public/app.min.js": "var a=1;\n",
      }),
    );
    expect(s.languages).toEqual([
      { language: "TypeScript", files: 2, lines: 6, nonBlank: 5 },
      { language: "CSS", files: 1, lines: 3, nonBlank: 3 },
    ]);
    expect(s.nonBlank).toBe(8);
    expect(s.frameworks).toEqual([]); // package.json above has no dependencies
  });

  it("detects frameworks from manifests and config files, ignoring vendored ones", async () => {
    const s = await countTarball(
      await tarball({
        "package.json": JSON.stringify({ dependencies: { next: "^15.1.0", react: "^19.0.0" }, devDependencies: { vitest: "^3.0.0" } }),
        "api/requirements.txt": "fastapi==0.115.0\n",
        "node_modules/express/package.json": JSON.stringify({ dependencies: { express: "4" } }),
        "Dockerfile": "FROM node:22\n",
        ".github/workflows/ci.yml": "on: push\n",
        "src/index.ts": "export {};\n",
      }),
    );
    expect(s.frameworks.map((f) => `${f.name}@${f.version}`)).toEqual([
      "React@19.0.0",
      "Next.js@15.1.0",
      "FastAPI@0.115.0",
      "Vitest@3.0.0",
      "Docker@null",
      "GitHub Actions@null",
    ]);
    // Manifests are read for frameworks but not counted as code; the vendored express file is neither
    expect(s.languages.map((l) => l.language).sort()).toEqual(["Dockerfile", "TypeScript"]);
  });

  it("handles an empty repository", async () => {
    expect((await countTarball(await tarball({}))).nonBlank).toBe(0);
  });
});
