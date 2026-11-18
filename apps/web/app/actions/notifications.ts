"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface ScoutNotificationData {
  id: string;
  scoutId: string;
  executionId?: string | null;
  title: string;
  message: string;
  urgency: "low" | "medium" | "high";
  read: boolean;
  createdAt: string;
}

export async function getScoutNotifications(scoutId: string): Promise<ScoutNotificationData[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scout_notifications")
    .select("*")
    .eq("scout_id", scoutId)
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    scoutId: row.scout_id,
    executionId: row.execution_id,
    title: row.title,
    message: row.message,
    urgency: row.urgency || "medium",
    read: Boolean(row.read),
    createdAt: row.created_at,
  }));
}

export async function markNotificationAsRead(id: string, scoutId?: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("scout_notifications")
    .update({ read: true })
    .eq("id", id);

  if (error) {
    return false;
  }

  if (scoutId) {
    revalidatePath(`/scouts/${scoutId}`);
  }
  return true;
}
