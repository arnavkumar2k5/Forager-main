import { defineConfig } from "drizzle-kit";
import { env } from "@repo/config-env";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      env.DATABASE_URL ||
      env.POSTGRES_URL ||
      "postgresql://postgres:postgres@localhost:54322/postgres",
  },
});
