import { describe, expect, it } from "vitest";
import { cleanVersion, compareVersions, detectFrameworks, isConfigSignal, manifestKind, parseManifest } from "@/lib/frameworks";

const npm = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  ({ kind: "npm" as const, deps: parseManifest("npm", JSON.stringify({ dependencies: deps, devDependencies: dev })) });

describe("manifests", () => {
  it("recognises manifest files", () => {
    expect(manifestKind("package.json")).toBe("npm");
    expect(manifestKind("apps/web/package.json")).toBe("npm");
    expect(manifestKind("requirements-dev.txt")).toBe("pypi");
    expect(manifestKind("backend/pyproject.toml")).toBe("pypi");
    expect(manifestKind("go.mod")).toBe("go");
    expect(manifestKind("build.gradle.kts")).toBe("maven");
    expect(manifestKind("package-lock.json")).toBeNull();
    expect(manifestKind("src/index.ts")).toBeNull();
  });

  it("cleans version ranges", () => {
    expect(cleanVersion("^15.0.3")).toBe("15.0.3");
    expect(cleanVersion("~4.2")).toBe("4.2");
    expect(cleanVersion(">=4.2,<5")).toBe("4.2");
    expect(cleanVersion("workspace:*")).toBeNull();
    expect(cleanVersion("latest")).toBeNull();
    expect(cleanVersion("github:user/repo")).toBeNull();
    expect(compareVersions("15.1.0", "15.0.9")).toBeGreaterThan(0);
  });

  it("parses Python requirements and pyproject (PEP 621 and Poetry)", () => {
    const req = parseManifest("pypi", "# web\nDjango==4.2.7\nflask[async]>=2.3\npsycopg2-binary\n-r base.txt\n");
    expect(req.get("django")).toBe("4.2.7");
    expect(req.get("flask")).toBe("2.3");
    expect(req.has("psycopg2-binary")).toBe(true);
    const pep = parseManifest("pypi", '[project]\nname = "app"\ndependencies = [\n  "fastapi>=0.110",\n  "SQLAlchemy~=2.0",\n]\n');
    expect(pep.get("fastapi")).toBe("0.110");
    expect(pep.get("sqlalchemy")).toBe("2.0");
    const poetry = parseManifest("pypi", '[tool.poetry.dependencies]\npython = "^3.11"\npandas = "^2.1.0"\n');
    expect(poetry.get("pandas")).toBe("2.1.0");
  });

  it("parses Gemfile, go.mod, Cargo.toml, composer.json and Gradle/Maven", () => {
    expect(parseManifest("gem", "source 'https://rubygems.org'\ngem 'rails', '~> 7.1.2'\ngem \"puma\"\n").get("rails")).toBe("7.1.2");
    const gomod = parseManifest("go", "module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgithub.com/labstack/echo/v4 v4.11.0\n)\n");
    expect(gomod.get("github.com/gin-gonic/gin")).toBe("1.9.1");
    const cargo = parseManifest("cargo", '[package]\nname = "x"\n\n[dependencies]\naxum = "0.7"\ntokio = { version = "1.35", features = ["full"] }\n');
    expect(cargo.get("axum")).toBe("0.7");
    expect(cargo.get("tokio")).toBe("1.35");
    expect(cargo.has("name")).toBe(false);
    expect(parseManifest("composer", '{"require":{"laravel/framework":"^10.10"}}').get("laravel/framework")).toBe("^10.10");
    expect(parseManifest("maven", 'implementation("org.springframework.boot:spring-boot-starter-web:3.2.0")').has("spring-boot-starter-web")).toBe(true);
    expect(parseManifest("npm", "{ not json").size).toBe(0);
  });
});

describe("detectFrameworks", () => {
  it("finds frameworks across manifests and config files, highest version wins, in category order", () => {
    const found = detectFrameworks(
      [
        npm({ next: "^15.0.3", react: "19.0.0", "@radix-ui/react-dialog": "^1.0.0" }, { tailwindcss: "^4.0.0", vitest: "^3.0.0", typescript: "^5.6" }),
        npm({ next: "14.2.0", express: "^4.19.2" }),
        { kind: "pypi", deps: parseManifest("pypi", "django==4.2\n") },
      ],
      ["Dockerfile", ".github/workflows/ci.yml", "vercel.json"],
    );
    expect(found.map((f) => [f.category, f.name, f.version])).toEqual([
      ["Frontend", "React", "19.0.0"],
      ["Full-stack", "Django", "4.2"],
      ["Full-stack", "Next.js", "15.0.3"],
      ["Backend", "Express", "4.19.2"],
      ["Styling & UI", "Radix UI", null], // scope match → no single version
      ["Styling & UI", "Tailwind CSS", "4.0.0"],
      ["Testing", "Vitest", "3.0.0"],
      ["Build & tooling", "TypeScript", "5.6"],
      ["Deployment", "Docker", null],
      ["Deployment", "GitHub Actions", null],
      ["Deployment", "Vercel", null],
    ]);
  });

  it("detects from config files alone and doesn't confuse similar names", () => {
    expect(detectFrameworks([], ["next.config.mjs", "tailwind.config.ts"]).map((f) => f.name)).toEqual(["Next.js", "Tailwind CSS"]);
    expect(detectFrameworks([npm({ "react-dom": "18", "next-auth": "4" })], []).map((f) => f.name)).toEqual([]);
    // A database found through its client library gets no (misleading) version
    expect(detectFrameworks([npm({ postgres: "^3.4.0" })], [])).toEqual([{ name: "PostgreSQL", category: "Data & ORM", version: null }]);
    expect(isConfigSignal(".github/workflows/deploy.yaml")).toBe(true);
    expect(isConfigSignal("docs/workflows/deploy.yaml")).toBe(false);
    expect(isConfigSignal("src/next.config.ts")).toBe(true); // nested apps in monorepos
  });
});
