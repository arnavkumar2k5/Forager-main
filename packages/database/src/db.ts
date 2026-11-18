import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@repo/config-env";
import * as schema from "./schema";

export type ForagerDb = ReturnType<typeof drizzle<typeof schema>>;

let dbInstance: ForagerDb | null = null;

export function getDb(connectionString?: string): ForagerDb {
  if (dbInstance) return dbInstance;

  const conn =
    connectionString ||
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    "postgresql://postgres:postgres@localhost:54322/postgres";

  const client = postgres(conn);
  dbInstance = drizzle(client, { schema });
  return dbInstance;
}

export * from "./schema";
