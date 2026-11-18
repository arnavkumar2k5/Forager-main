import { env } from "@repo/config-env";
import {
  getServiceClient,
  ExecutionRepository,
  UpdateExecutionParams,
} from "@repo/database";
import { server } from "../server";
import { getExecutionRepoOverride } from "./overrides";

export async function getScoutSafe(
  scoutId: string
): Promise<{ found: boolean; scout?: Record<string, unknown>; warning?: string }> {
  const repoOverride = getExecutionRepoOverride();
  if (repoOverride) {
    try {
      const scout = await repoOverride.findScoutById(scoutId);
      return { found: Boolean(scout), scout: scout || undefined };
    } catch (err) {
      server.log.warn({ err, scoutId }, "Overridden execution repository findScoutById failed");
      return { found: false, warning: (err as Error).message };
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
      found: false,
      warning: "Database credentials unconfigured; cannot look up scout.",
    };
  }

  try {
    const client = getServiceClient();
    const repo = new ExecutionRepository(client);
    const scout = await repo.findScoutById(scoutId);
    return { found: Boolean(scout), scout: scout || undefined };
  } catch (err) {
    server.log.warn({ err, scoutId }, "Execution repository findScoutById failed");
    return { found: false, warning: (err as Error).message };
  }
}

export async function createExecutionSafe(params: {
  id: string;
  scoutId?: string;
  status: "running" | "completed" | "failed";
  startedAt?: string;
}): Promise<{ success: boolean; warning?: string }> {
  if (!params.scoutId) {
    return { success: false, warning: "Ad-hoc execution without scoutId; execution tracked in-memory." };
  }

  const repoOverride = getExecutionRepoOverride();
  if (repoOverride) {
    try {
      await repoOverride.createExecution({
        id: params.id,
        scoutId: params.scoutId,
        status: params.status,
        startedAt: params.startedAt,
      });
      return { success: true };
    } catch (err) {
      server.log.warn({ err, executionId: params.id }, "Overridden execution repository createExecution failed");
      return { success: false, warning: (err as Error).message };
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
    return { success: false, warning: "Database credentials unconfigured" };
  }

  try {
    const client = getServiceClient();
    const repo = new ExecutionRepository(client);
    await repo.createExecution({
      id: params.id,
      scoutId: params.scoutId,
      status: params.status,
      startedAt: params.startedAt,
    });
    return { success: true };
  } catch (err) {
    server.log.warn({ err, executionId: params.id }, "Execution repository createExecution failed; failing open");
    return { success: false, warning: (err as Error).message };
  }
}

export async function updateExecutionSafe(
  id: string,
  params: UpdateExecutionParams
): Promise<{ success: boolean; warning?: string }> {
  const repoOverride = getExecutionRepoOverride();
  if (repoOverride) {
    try {
      await repoOverride.updateExecution(id, params);
      return { success: true };
    } catch (err) {
      server.log.warn({ err, executionId: id }, "Overridden execution repository updateExecution failed");
      return { success: false, warning: (err as Error).message };
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
    return { success: false, warning: "Database credentials unconfigured" };
  }

  try {
    const client = getServiceClient();
    const repo = new ExecutionRepository(client);
    await repo.updateExecution(id, params);
    return { success: true };
  } catch (err) {
    server.log.warn({ err, executionId: id }, "Execution repository updateExecution failed; failing open");
    return { success: false, warning: (err as Error).message };
  }
}

