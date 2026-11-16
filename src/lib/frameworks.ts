/**
 * Framework & tool detection from dependency manifests and config files found while streaming a
 * repo's tarball (src/lib/loc.ts) — no extra API calls. Based on *declared* dependencies, the same
 * signal GitHub's dependency graph uses: a package listed but never imported still counts.
 */

export const CATEGORIES = [
  "Frontend",
  "Full-stack",
  "Backend",
  "Mobile & desktop",
  "Styling & UI",
  "Data & ORM",
  "AI & data science",
  "Testing",
  "Build & tooling",
  "Deployment",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Eco = "npm" | "pypi" | "gem" | "composer" | "go" | "cargo" | "maven";

type Rule = {
  name: string;
  category: Category;
  /** Package names per ecosystem; a trailing "/" matches a scope or path prefix (e.g. "@nestjs/") */
  deps?: Partial<Record<Eco, string[]>>;
  /** Config file names (basename) that alone signal the tool */
  files?: RegExp;
  /** Detected through a client library whose version says nothing about the tool itself (pg → PostgreSQL) */
  noVersion?: boolean;
};

export const RULES: Rule[] = [
  // Frontend
  { name: "React", category: "Frontend", deps: { npm: ["react"] } },
  { name: "Vue", category: "Frontend", deps: { npm: ["vue"] } },
  { name: "Svelte", category: "Frontend", deps: { npm: ["svelte"] } },
  { name: "Angular", category: "Frontend", deps: { npm: ["@angular/core"] }, files: /^angular\.json$/ },
  { name: "Solid", category: "Frontend", deps: { npm: ["solid-js"] } },
  { name: "Preact", category: "Frontend", deps: { npm: ["preact"] } },
  { name: "Three.js", category: "Frontend", deps: { npm: ["three"] } },
  { name: "D3", category: "Frontend", deps: { npm: ["d3"] } },
  { name: "Recharts", category: "Frontend", deps: { npm: ["recharts"] } },
  { name: "Mapbox", category: "Frontend", deps: { npm: ["mapbox-gl", "react-map-gl"] } },
  { name: "Leaflet", category: "Frontend", deps: { npm: ["leaflet"] } },
  { name: "Redux", category: "Frontend", deps: { npm: ["@reduxjs/toolkit", "redux"] } },
  { name: "TanStack Query", category: "Frontend", deps: { npm: ["@tanstack/react-query"] } },
  { name: "Socket.IO", category: "Frontend", deps: { npm: ["socket.io", "socket.io-client"] } },
  // Full-stack / meta-frameworks
  { name: "Next.js", category: "Full-stack", deps: { npm: ["next"] }, files: /^next\.config\.(js|mjs|cjs|ts)$/ },
  { name: "Nuxt", category: "Full-stack", deps: { npm: ["nuxt"] } },
  { name: "SvelteKit", category: "Full-stack", deps: { npm: ["@sveltejs/kit"] } },
  { name: "Remix", category: "Full-stack", deps: { npm: ["@remix-run/react", "@react-router/dev"] } },
  { name: "Astro", category: "Full-stack", deps: { npm: ["astro"] } },
  { name: "Gatsby", category: "Full-stack", deps: { npm: ["gatsby"] } },
  { name: "Django", category: "Full-stack", deps: { pypi: ["django"] }, files: /^manage\.py$/ },
  { name: "Rails", category: "Full-stack", deps: { gem: ["rails"] } },
  { name: "Laravel", category: "Full-stack", deps: { composer: ["laravel/framework"] } },
  // Backend
  { name: "Express", category: "Backend", deps: { npm: ["express"] } },
  { name: "NestJS", category: "Backend", deps: { npm: ["@nestjs/core"] } },
  { name: "Fastify", category: "Backend", deps: { npm: ["fastify"] } },
  { name: "Hono", category: "Backend", deps: { npm: ["hono"] } },
  { name: "Koa", category: "Backend", deps: { npm: ["koa"] } },
  { name: "GraphQL", category: "Backend", deps: { npm: ["graphql", "@apollo/server", "apollo-server"], pypi: ["graphene", "strawberry-graphql"] } },
  { name: "tRPC", category: "Backend", deps: { npm: ["@trpc/server"] } },
  { name: "Flask", category: "Backend", deps: { pypi: ["flask"] } },
  { name: "FastAPI", category: "Backend", deps: { pypi: ["fastapi"] } },
  { name: "Django REST", category: "Backend", deps: { pypi: ["djangorestframework"] } },
  { name: "Sinatra", category: "Backend", deps: { gem: ["sinatra"] } },
  { name: "Gin", category: "Backend", deps: { go: ["github.com/gin-gonic/gin"] } },
  { name: "Echo", category: "Backend", deps: { go: ["github.com/labstack/echo/"] } },
  { name: "Fiber", category: "Backend", deps: { go: ["github.com/gofiber/fiber/"] } },
  { name: "Axum", category: "Backend", deps: { cargo: ["axum"] } },
  { name: "Actix", category: "Backend", deps: { cargo: ["actix-web"] } },
  { name: "Spring Boot", category: "Backend", deps: { maven: ["spring-boot"] } },
  // Mobile & desktop
  { name: "React Native", category: "Mobile & desktop", deps: { npm: ["react-native"] } },
  { name: "Expo", category: "Mobile & desktop", deps: { npm: ["expo"] } },
  { name: "Electron", category: "Mobile & desktop", deps: { npm: ["electron"] } },
  { name: "Tauri", category: "Mobile & desktop", deps: { npm: ["@tauri-apps/api"], cargo: ["tauri"] } },
  { name: "Ionic", category: "Mobile & desktop", deps: { npm: ["@ionic/core", "@ionic/react", "@ionic/angular"] } },
  { name: "Capacitor", category: "Mobile & desktop", deps: { npm: ["@capacitor/core"] } },
  { name: "Flutter", category: "Mobile & desktop", files: /^pubspec\.yaml$/ },
  // Styling & UI
  { name: "Tailwind CSS", category: "Styling & UI", deps: { npm: ["tailwindcss"] }, files: /^tailwind\.config\.(js|cjs|mjs|ts)$/ },
  { name: "Bootstrap", category: "Styling & UI", deps: { npm: ["bootstrap", "react-bootstrap"] } },
  { name: "Material UI", category: "Styling & UI", deps: { npm: ["@mui/material", "@material-ui/core"] } },
  { name: "Chakra UI", category: "Styling & UI", deps: { npm: ["@chakra-ui/react"] } },
  { name: "shadcn/ui", category: "Styling & UI", files: /^components\.json$/ },
  { name: "Radix UI", category: "Styling & UI", deps: { npm: ["@radix-ui/"] } },
  { name: "styled-components", category: "Styling & UI", deps: { npm: ["styled-components"] } },
  { name: "Sass", category: "Styling & UI", deps: { npm: ["sass", "node-sass"] } },
  { name: "Framer Motion", category: "Styling & UI", deps: { npm: ["framer-motion", "motion"] } },
  // Data & ORM
  { name: "Prisma", category: "Data & ORM", deps: { npm: ["prisma", "@prisma/client"] } },
  { name: "Drizzle", category: "Data & ORM", deps: { npm: ["drizzle-orm"] } },
  { name: "Mongoose", category: "Data & ORM", deps: { npm: ["mongoose"] } },
  { name: "MongoDB", category: "Data & ORM", deps: { npm: ["mongodb"], pypi: ["pymongo"] }, noVersion: true },
  { name: "Sequelize", category: "Data & ORM", deps: { npm: ["sequelize"] } },
  { name: "TypeORM", category: "Data & ORM", deps: { npm: ["typeorm"] } },
  { name: "PostgreSQL", category: "Data & ORM", deps: { npm: ["pg", "postgres", "@neondatabase/serverless"], pypi: ["psycopg2", "psycopg2-binary", "psycopg"] }, noVersion: true },
  { name: "SQLAlchemy", category: "Data & ORM", deps: { pypi: ["sqlalchemy"] } },
  { name: "Firebase", category: "Data & ORM", deps: { npm: ["firebase", "firebase-admin", "firebase-functions"], pypi: ["firebase-admin"] }, files: /^firebase\.json$/ },
  { name: "Supabase", category: "Data & ORM", deps: { npm: ["@supabase/supabase-js"], pypi: ["supabase"] } },
  { name: "Redis", category: "Data & ORM", deps: { npm: ["redis", "ioredis"], pypi: ["redis"] }, noVersion: true },
  // AI & data science
  { name: "OpenAI SDK", category: "AI & data science", deps: { npm: ["openai"], pypi: ["openai"] } },
  { name: "Anthropic SDK", category: "AI & data science", deps: { npm: ["@anthropic-ai/sdk"], pypi: ["anthropic"] } },
  { name: "LangChain", category: "AI & data science", deps: { npm: ["langchain", "@langchain/"], pypi: ["langchain", "langchain-core"] } },
  { name: "Vercel AI SDK", category: "AI & data science", deps: { npm: ["ai"] } },
  { name: "TensorFlow", category: "AI & data science", deps: { npm: ["@tensorflow/tfjs"], pypi: ["tensorflow"] } },
  { name: "PyTorch", category: "AI & data science", deps: { pypi: ["torch"] } },
  { name: "scikit-learn", category: "AI & data science", deps: { pypi: ["scikit-learn"] } },
  { name: "pandas", category: "AI & data science", deps: { pypi: ["pandas"] } },
  { name: "NumPy", category: "AI & data science", deps: { pypi: ["numpy"] } },
  { name: "Jupyter", category: "AI & data science", deps: { pypi: ["jupyter", "notebook", "jupyterlab"] } },
  // Testing
  { name: "Jest", category: "Testing", deps: { npm: ["jest"] } },
  { name: "Vitest", category: "Testing", deps: { npm: ["vitest"] } },
  { name: "Playwright", category: "Testing", deps: { npm: ["@playwright/test", "playwright"], pypi: ["playwright"] } },
  { name: "Cypress", category: "Testing", deps: { npm: ["cypress"] } },
  { name: "Testing Library", category: "Testing", deps: { npm: ["@testing-library/"] } },
  { name: "Mocha", category: "Testing", deps: { npm: ["mocha"] } },
  { name: "pytest", category: "Testing", deps: { pypi: ["pytest"] } },
  { name: "RSpec", category: "Testing", deps: { gem: ["rspec", "rspec-rails"] } },
  // Build & tooling
  { name: "TypeScript", category: "Build & tooling", deps: { npm: ["typescript"] }, files: /^tsconfig\.json$/ },
  { name: "Vite", category: "Build & tooling", deps: { npm: ["vite"] }, files: /^vite\.config\.(js|mjs|cjs|ts|mts)$/ },
  { name: "Webpack", category: "Build & tooling", deps: { npm: ["webpack"] } },
  { name: "Parcel", category: "Build & tooling", deps: { npm: ["parcel"] } },
  { name: "ESLint", category: "Build & tooling", deps: { npm: ["eslint"] } },
  { name: "Prettier", category: "Build & tooling", deps: { npm: ["prettier"] } },
  { name: "Biome", category: "Build & tooling", deps: { npm: ["@biomejs/biome"] } },
  { name: "Turborepo", category: "Build & tooling", deps: { npm: ["turbo"] }, files: /^turbo\.json$/ },
  // Deployment
  { name: "Docker", category: "Deployment", files: /^(Dockerfile(\..+)?|docker-compose\.ya?ml|compose\.ya?ml)$/ },
  { name: "GitHub Actions", category: "Deployment", files: /^\.github\/workflows\/[^/]+\.ya?ml$/ },
  { name: "Vercel", category: "Deployment", files: /^vercel\.json$/ },
  { name: "Netlify", category: "Deployment", files: /^netlify\.toml$/ },
  { name: "Fly.io", category: "Deployment", files: /^fly\.toml$/ },
  { name: "Railway", category: "Deployment", files: /^railway\.(json|toml)$/ },
  { name: "Heroku", category: "Deployment", files: /^Procfile$/ },
];

/** Manifest file names (basename) that are read for dependencies. */
export function manifestKind(path: string): Eco | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "package.json") return "npm";
  if (/^requirements[\w.-]*\.txt$/.test(name) || name === "pyproject.toml" || name === "Pipfile" || name === "setup.py") return "pypi";
  if (name === "Gemfile") return "gem";
  if (name === "composer.json") return "composer";
  if (name === "go.mod") return "go";
  if (name === "Cargo.toml") return "cargo";
  if (name === "pom.xml" || /^build\.gradle(\.kts)?$/.test(name)) return "maven";
  return null;
}

/** True for config files some rule detects by name (they are tiny; read nothing, just note the path). */
export function isConfigSignal(path: string): boolean {
  return RULES.some((r) => r.files && (r.files.test(basename(path)) || r.files.test(path)));
}

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Strip range operators so "^15.0.3" → "15.0.3"; null for tags/urls/workspace refs. */
export function cleanVersion(spec: string | undefined | null): string | null {
  if (!spec) return null;
  const m = /(\d+(?:\.\d+){0,2})/.exec(spec.replace(/^[^\d]*/, ""));
  return m && /^[\s^~>=<v]*\d/.test(spec) ? m[1] : null;
}

/** Dependencies declared in one manifest → package name (lower-case except npm/go/maven) → version spec. */
export function parseManifest(kind: Eco, text: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const add = (name: string, version: string | null = null) => {
    if (name && !out.has(name)) out.set(name, version);
  };
  try {
    switch (kind) {
      case "npm": {
        const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
        for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])
          for (const [n, v] of Object.entries(pkg[k] ?? {})) add(n, typeof v === "string" ? v : null);
        break;
      }
      case "composer": {
        const pkg = JSON.parse(text) as Record<string, Record<string, string> | undefined>;
        for (const k of ["require", "require-dev"]) for (const [n, v] of Object.entries(pkg[k] ?? {})) add(n.toLowerCase(), v);
        break;
      }
      case "pypi": {
        // requirements.txt lines, pyproject/Pipfile/setup.py strings and keys: name, optional extras, version
        const re = /(?:^|["'\s,[])([A-Za-z][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:(==|>=|~=|<=|>|<|=)\s*["']?\s*(?:[=<>~^]*\s*)?([\d][\w.*]*))?/gm;
        for (const line of text.split(/\r?\n/)) {
          if (/^\s*(#|\[)/.test(line)) continue;
          for (const m of line.matchAll(re)) add(m[1].toLowerCase().replace(/_/g, "-"), m[3] ?? null);
        }
        break;
      }
      case "gem":
        for (const m of text.matchAll(/^\s*gem\s+["']([\w-]+)["'](?:\s*,\s*["'][~>=<\s]*([\d.]+))?/gm)) add(m[1].toLowerCase(), m[2] ?? null);
        break;
      case "go":
        for (const m of text.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[a-z]+\/[\w./-]+)\s+v([\d.]+)/gm)) add(m[1], m[2]);
        break;
      case "cargo": {
        let inDeps = false;
        for (const line of text.split(/\r?\n/)) {
          const sec = /^\s*\[([^\]]+)\]/.exec(line);
          if (sec) {
            inDeps = /dependencies$/.test(sec[1]);
            continue;
          }
          const m = inDeps && /^\s*([\w-]+)\s*=\s*(?:"([^"]*)"|\{[^}]*version\s*=\s*"([^"]*)")?/.exec(line);
          if (m) add(m[1].toLowerCase(), m[2] ?? m[3] ?? null);
        }
        break;
      }
      case "maven":
        for (const m of text.matchAll(/<artifactId>([\w.-]+)<\/artifactId>(?:\s*<version>([^<]+)<\/version>)?/g)) add(m[1], m[2] ?? null);
        for (const m of text.matchAll(/["']([\w.-]+):([\w.-]+)(?::([\w.-]+))?["']/g)) add(m[2], m[3] ?? null);
        for (const m of text.matchAll(/id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?\s*version\s*["']([\d.]+)/g)) add("spring-boot", m[1]);
        break;
    }
  } catch {
    // Malformed manifest: detect nothing from it
  }
  return out;
}

export type DetectedFramework = {
  name: string;
  category: Category;
  version: string | null;
  /** The dependency that matched (for checking the latest release), null for config-file detections */
  package?: string | null;
  ecosystem?: Eco | null;
};

const depMatches = (pattern: string, dep: string) => (pattern.endsWith("/") ? dep.startsWith(pattern) : dep === pattern || (pattern === "spring-boot" && dep.startsWith("spring-boot")));

/**
 * Frameworks from all manifests in a repo plus the config file paths seen. When several manifests
 * declare the same framework (monorepos), the highest version wins.
 */
export function detectFrameworks(manifests: { kind: Eco; deps: Map<string, string | null> }[], configPaths: string[]): DetectedFramework[] {
  const found = new Map<string, DetectedFramework>();
  const note = (rule: Rule, version: string | null, pkg: string | null = null, eco: Eco | null = null) => {
    const cur = found.get(rule.name);
    if (!cur) found.set(rule.name, { name: rule.name, category: rule.category, version, package: pkg, ecosystem: eco });
    else if (version && (!cur.version || compareVersions(version, cur.version) > 0)) Object.assign(cur, { version, package: pkg, ecosystem: eco });
    else if (!cur.package && pkg) Object.assign(cur, { package: pkg, ecosystem: eco });
  };
  for (const rule of RULES) {
    for (const [eco, patterns] of Object.entries(rule.deps ?? {}) as [Eco, string[]][]) {
      for (const m of manifests) {
        if (m.kind !== eco) continue;
        for (const [dep, spec] of m.deps) {
          if (patterns.some((p) => depMatches(p, dep))) {
            const versioned = !rule.noVersion && !patterns.some((p) => p.endsWith("/"));
            note(rule, versioned ? cleanVersion(spec) : null, versioned ? dep : null, versioned ? eco : null);
          }
        }
      }
    }
    if (rule.files && configPaths.some((p) => rule.files!.test(basename(p)) || rule.files!.test(p))) note(rule, null);
  }
  return [...found.values()].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
