import type { ScentMetric } from "@repo/types";
import { ScentRepository, getServiceClient } from "@repo/database";
import { env } from "@repo/config-env";
import { server } from "../server";
import { inMemoryScentMetricsStore } from "./memory-stores";
import { getScentRepoOverride } from "./overrides";

export async function detectPersistenceMode(): Promise<{
  mode: "database_durable" | "in_memory_transient";
  warning?: string;
}> {
  const repoOverride = getScentRepoOverride();
  if (repoOverride) {
    try {
      const ok = await repoOverride.verifySchemaAccess();
      if (ok) return { mode: "database_durable" };
      return {
        mode: "in_memory_transient",
        warning:
          "Scent repository schema access failed. Schedules will not survive worker restart until remote scent_metrics table is migrated.",
      };
    } catch {
      return {
        mode: "in_memory_transient",
        warning:
          "Scent repository probe error. Schedules will not survive worker restart until remote scent_metrics table is migrated.",
      };
    }
  }

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const isUnconfigured =
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes("your-project") ||
    serviceRoleKey.includes("your-supabase");

  if (isUnconfigured) {
    return {
      mode: "in_memory_transient",
      warning:
        "Database credentials unconfigured. Schedules will not survive worker restart until remote scent_metrics table is migrated.",
    };
  }

  try {
    const client = getServiceClient();
    const repo = new ScentRepository(client);
    const ok = await repo.verifySchemaAccess();
    if (ok) return { mode: "database_durable" };
    return {
      mode: "in_memory_transient",
      warning:
        "Remote scent_metrics schema unavailable in database. Schedules will not survive worker restart until remote scent_metrics table is migrated.",
    };
  } catch {
    return {
      mode: "in_memory_transient",
      warning:
        "Database unreachable. Schedules will not survive worker restart until remote scent_metrics table is migrated.",
    };
  }
}

export async function saveScentMetricSafe(
  metric: ScentMetric
): Promise<{ source: "database" | "in_memory_fallback"; warning?: string }> {
  const existing = inMemoryScentMetricsStore.get(metric.scoutId) || [];
  inMemoryScentMetricsStore.set(metric.scoutId, [...existing, metric]);

  const repoOverride = getScentRepoOverride();
  if (repoOverride) {
    try {
      await repoOverride.recordMetric(metric);
      return { source: "database" };
    } catch (err) {
      server.log.warn({ err, scoutId: metric.scoutId }, "Overridden scent repository recordMetric failed; failing open");
      return {
        source: "in_memory_fallback",
        warning: `Database unavailable (${(err as Error).message}); metric kept in memory. Schedules will not survive restart.`,
      };
    }
  }

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const isUnconfigured =
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes("your-project") ||
    serviceRoleKey.includes("your-supabase");

  if (isUnconfigured) {
    return {
      source: "in_memory_fallback",
      warning: "Database credentials unconfigured; metric kept in memory. Schedules will not survive restart.",
    };
  }

  try {
    const client = getServiceClient();
    const repo = new ScentRepository(client);
    await repo.recordMetric(metric);
    return { source: "database" };
  } catch (err) {
    server.log.warn({ err, scoutId: metric.scoutId }, "Scent repository recordMetric failed; failing open");
    return {
      source: "in_memory_fallback",
      warning: `Database unavailable (${(err as Error).message}); metric kept in memory. Schedules will not survive restart.`,
    };
  }
}

export async function updateScoutScheduleSafe(
  scoutId: string,
  params: { lastRunAt?: string; consecutiveFailures?: number }
): Promise<void> {
  const repoOverride = getScentRepoOverride();
  if (repoOverride) {
    try {
      await repoOverride.updateScoutSchedule(scoutId, params);
      return;
    } catch (err) {
      server.log.warn({ err, scoutId }, "Overridden scent repository updateScoutSchedule failed; failing open");
      return;
    }
  }

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const isUnconfigured =
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes("your-project") ||
    serviceRoleKey.includes("your-supabase");

  if (isUnconfigured) return;

  try {
    const client = getServiceClient();
    const repo = new ScentRepository(client);
    await repo.updateScoutSchedule(scoutId, params);
  } catch (err) {
    server.log.warn({ err, scoutId }, "Scent repository updateScoutSchedule failed; failing open");
  }
}
