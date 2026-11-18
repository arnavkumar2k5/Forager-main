import { TrajectoryStep } from "@repo/types";
import { env } from "@repo/config-env";
import {
  getServiceClient,
  TrajectoryRepository,
  CreateRunningStepParams,
  CompleteStepParams,
} from "@repo/database";
import { server } from "../server";
import { getTrajectoryRepoOverride } from "./overrides";

export async function saveTrajectoryStepSafe(
  executionId: string,
  step: TrajectoryStep
): Promise<{ success: boolean; warning?: string }> {
  const repoOverride = getTrajectoryRepoOverride();
  if (repoOverride) {
    try {
      await repoOverride.saveStep(executionId, step);
      return { success: true };
    } catch (err) {
      server.log.warn(
        { err, executionId, stepNumber: step.stepNumber },
        "Overridden trajectory repository saveStep failed"
      );
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
    const repo = new TrajectoryRepository(client);
    await repo.saveStep(executionId, step);
    return { success: true };
  } catch (err) {
    server.log.warn(
      { err, executionId, stepNumber: step.stepNumber },
      "Trajectory repository saveStep failed; failing open"
    );
    return { success: false, warning: (err as Error).message };
  }
}

export async function updateStepOutputDataSafe(
  executionId: string,
  stepNumber: number,
  outputData: Record<string, unknown>
): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return;
  try {
    const client = getServiceClient();
    const repo = new TrajectoryRepository(client);
    await repo.updateStepOutputData(executionId, stepNumber, outputData);
  } catch (err) {
    server.log.warn({ err, executionId, stepNumber }, "Failed to update step output data; continuing");
  }
}

export async function createRunningStepSafe(
  params: CreateRunningStepParams
): Promise<{ success: boolean; warning?: string }> {
  const repoOverride = getTrajectoryRepoOverride();
  if (repoOverride) {
    if (typeof (repoOverride as any).createRunningStep === "function") {
      try {
        await (repoOverride as any).createRunningStep(params);
        return { success: true };
      } catch (err) {
        server.log.warn({ err, params }, "Overridden trajectory repository createRunningStep failed");
        return { success: false, warning: (err as Error).message };
      }
    }
    return { success: true };
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
    const repo = new TrajectoryRepository(client);
    await repo.createRunningStep(params);
    return { success: true };
  } catch (err) {
    server.log.warn({ err, params }, "Trajectory repository createRunningStep failed; failing open");
    return { success: false, warning: (err as Error).message };
  }
}

export async function completeTrajectoryStepSafe(
  params: CompleteStepParams
): Promise<{ success: boolean; warning?: string }> {
  const repoOverride = getTrajectoryRepoOverride();
  if (repoOverride) {
    if (typeof (repoOverride as any).completeStep === "function") {
      try {
        await (repoOverride as any).completeStep(params);
        return { success: true };
      } catch (err) {
        server.log.warn({ err, params }, "Overridden trajectory repository completeStep failed");
        return { success: false, warning: (err as Error).message };
      }
    }
    return { success: true };
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
    const repo = new TrajectoryRepository(client);
    await repo.completeStep(params);
    return { success: true };
  } catch (err) {
    server.log.warn({ err, params }, "Trajectory repository completeStep failed; failing open");
    return { success: false, warning: (err as Error).message };
  }
}

