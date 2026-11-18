import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findMonorepoRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(current, "turbo.json"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function parseEnvLines(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return result;

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      } else {
        const commentIdx = val.indexOf("#");
        if (commentIdx !== -1) {
          val = val.slice(0, commentIdx).trim();
        }
      }
      result[key] = val;
    }
  } catch { }

  return result;
}

function loadMonorepoEnvironment(): void {
  const moduleDir =
    typeof import.meta.url === "string"
      ? path.dirname(fileURLToPath(import.meta.url))
      : process.cwd();

  const rootDir =
    findMonorepoRoot(process.cwd()) ||
    findMonorepoRoot(moduleDir);

  const envPathsToLoad: string[] = [];

  if (rootDir) {
    envPathsToLoad.push(path.join(rootDir, ".env"));
  }

  const localEnvPath = path.resolve(process.cwd(), ".env");
  if (!envPathsToLoad.includes(localEnvPath)) {
    envPathsToLoad.push(localEnvPath);
  }

  for (const envPath of envPathsToLoad) {
    if (typeof process.loadEnvFile === "function" && fs.existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
      } catch { }
    }

    const parsed = parseEnvLines(envPath);
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
}

loadMonorepoEnvironment();

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.string().optional().default("4000"),
    AGENT_WORKER_URL: z.string().optional().default("http://localhost:4000"),
    SUPABASE_URL: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    POSTGRES_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),
    FIRECRAWL_API_KEY: z.string().optional(),
    AI_PROVIDER: z.string().optional(),
    MODEL_PROVIDER: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    GROQ_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().optional(),
    CHAT_MODEL: z.string().optional(),
    SCOUT_MODEL: z.string().optional(),
    GEMINI_EMBEDDING_MODEL: z.string().optional().default("gemini-embedding-2"),
    EMBEDDING_DIMENSIONS: z.string().optional().default("1024"),
    LLM_MAX_RPM: z.string().optional(),
    LLM_MAX_RETRIES: z.string().optional().default("3"),
    RESEND_API_KEY: z.string().optional(),
    NOTIFICATION_FROM_EMAIL: z.string().optional().default("onboarding@resend.dev"),
    NOTIFICATION_RECIPIENT_EMAIL: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.NODE_ENV === "test",
});

export type Env = typeof env;
