"use server";

import { createClient } from "@/lib/supabase/server";
import { runScoutTask, registerScoutWithScheduler } from "@/lib/agent-worker";
import { revalidatePath } from "next/cache";

export interface CreateScoutInput {
  title: string;
  goal: string;
  schedule: "daily" | "every_3_days" | "weekly";
  maxSteps?: number;
  location?: Record<string, unknown> | null;
  searchQueries?: string[];
}

export async function createAndRunScout(input: CreateScoutInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized: please sign in to create a scout.");
  }

  const { data: newScout, error: insertError } = await supabase
    .from("scouts")
    .insert({
      user_id: user.id,
      title: input.title,
      goal: input.goal,
      description: input.goal,
      frequency: input.schedule,
      is_active: true,
      search_queries: input.searchQueries || [],
      location: input.location || null,
    })
    .select()
    .single();

  if (insertError || !newScout) {
    throw new Error(`Failed to create scout: ${insertError?.message || "Unknown error"}`);
  }

  // Trigger initial trajectory in the background via agent-worker
  let executionId: string | undefined;
  try {
    const runRes = await runScoutTask({
      scoutId: newScout.id,
      query: input.goal,
      goal: input.goal,
      title: input.title,
      maxSteps: input.maxSteps || 8,
      searchQueries: input.searchQueries || [],
    });
    executionId = runRes.executionId;
  } catch (workerErr) {
    console.error("Agent worker execution notice:", workerErr);
  }

  revalidatePath("/scouts");
  return { scoutId: newScout.id, executionId };
}

export async function triggerScoutRun(params: {
  scoutId: string;
  query?: string;
  goal?: string;
  title?: string;
  maxSteps?: number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized: please sign in to run a scout.");
  }

  // Update scout status to active
  await supabase
    .from("scouts")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", params.scoutId);

  let effectiveQuery = params.query?.trim() || params.goal?.trim();
  let effectiveGoal = params.goal?.trim();
  let effectiveTitle = params.title?.trim();

  if (!effectiveQuery) {
    const { data: dbScout } = await supabase
      .from("scouts")
      .select("title, goal, description")
      .eq("id", params.scoutId)
      .single();

    if (dbScout) {
      effectiveGoal = dbScout.goal || dbScout.description || effectiveGoal;
      effectiveTitle = dbScout.title || effectiveTitle;
      effectiveQuery = effectiveGoal || effectiveTitle || "Targeted web research";
    }
  }

  // Trigger agent worker
  const result = await runScoutTask({
    scoutId: params.scoutId,
    query: effectiveQuery || "Targeted web research",
    goal: effectiveGoal || effectiveQuery || "Targeted web research",
    title: effectiveTitle || "Research Scout",
    maxSteps: params.maxSteps || 10,
  });

  revalidatePath(`/scouts/${params.scoutId}`);
  return result;
}

export interface UpdateScoutInput {
  scoutId: string;
  title: string;
  goal: string;
  frequency: "daily" | "every_3_days" | "weekly";
  isActive: boolean;
  searchQueries?: string[];
  location?: Record<string, unknown> | null;
}

export async function updateScout(input: UpdateScoutInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized: please sign in to update scout.");
  }

  const updatePayload: Record<string, unknown> = {
    title: input.title,
    goal: input.goal,
    description: input.goal,
    frequency: input.frequency,
    is_active: input.isActive,
    search_queries: input.searchQueries || [],
    updated_at: new Date().toISOString(),
  };

  if (input.location !== undefined) {
    updatePayload.location = input.location;
  }

  const { data: updated, error } = await supabase
    .from("scouts")
    .update(updatePayload)
    .eq("id", input.scoutId)
    .select()
    .single();

  if (error || !updated) {
    throw new Error(`Failed to update scout: ${error?.message || "Unknown error"}`);
  }

  await registerScoutWithScheduler({
    id: input.scoutId,
    goal: input.goal,
    frequency: input.frequency,
    isActive: input.isActive,
  });

  revalidatePath(`/scouts/${input.scoutId}`);
  revalidatePath("/scouts");
  return updated;
}

export async function toggleScoutActive(scoutId: string, isActive: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized: please sign in to update scout.");
  }

  const { data: scout, error } = await supabase
    .from("scouts")
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scoutId)
    .select("id, goal, frequency")
    .single();

  if (error) {
    throw new Error(`Failed to toggle scout: ${error.message}`);
  }

  if (scout) {
    await registerScoutWithScheduler({
      id: scout.id,
      goal: (scout.goal as string) || "Web Research",
      frequency: (scout.frequency as string) || "daily",
      isActive,
    });
  }

  revalidatePath(`/scouts/${scoutId}`);
  revalidatePath("/scouts");
  return { success: true, isActive };
}

export async function deleteScout(scoutId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized: please sign in to delete scout.");
  }

  const { error } = await supabase.from("scouts").delete().eq("id", scoutId);
  if (error) {
    throw new Error(`Failed to delete scout: ${error.message}`);
  }

  revalidatePath("/scouts");
  return { success: true };
}
