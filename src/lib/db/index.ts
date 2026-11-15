import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Both drivers expose the same query-builder API; we type against the Neon one.
 * Neon URLs (…neon.tech) use the HTTP driver (ideal for serverless); anything else
 * (Railway, Supabase, local Docker) uses a regular TCP connection via postgres.js.
 */
type Db = NeonHttpDatabase<typeof schema>;

let _db: Db | null = null;

/** Lazily created so builds work without DATABASE_URL. */
export function getDb(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const useNeon = process.env.DB_DRIVER === "neon" || (process.env.DB_DRIVER !== "pg" && /\.neon\.tech/.test(url));
    _db = useNeon
      ? drizzleNeon(neon(url), { schema })
      : (drizzlePg(postgres(url, { max: Number(process.env.DB_POOL_MAX ?? 5), prepare: false }), { schema }) as unknown as Db);
  }
  return _db;
}

export function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL) || _db !== null;
}

/** Test hook: inject an alternative drizzle instance (e.g. PGlite in-memory Postgres). */
export function setDbForTesting(db: unknown) {
  _db = db as Db;
}

export { schema };
