import { SupabaseClient } from "@supabase/supabase-js";

export interface CreateNotificationParams {
  id?: string;
  scoutId: string;
  executionId?: string;
  title: string;
  message: string;
  urgency?: "low" | "medium" | "high";
  read?: boolean;
}

export class NotificationRepository {
  constructor(private client: SupabaseClient) {}

  async createNotification(params: CreateNotificationParams): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      scout_id: params.scoutId,
      execution_id: params.executionId || null,
      title: params.title,
      message: params.message,
      urgency: params.urgency || "medium",
      read: params.read ?? false,
    };
    if (params.id) {
      payload.id = params.id;
    }

    const { data, error } = await this.client
      .from("scout_notifications")
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create scout notification: ${error.message}`);
    }
    return data;
  }

  async findByScoutId(scoutId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client
      .from("scout_notifications")
      .select("*")
      .eq("scout_id", scoutId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch notifications for scout ${scoutId}: ${error.message}`);
    }
    return data || [];
  }

  async markAsRead(id: string): Promise<void> {
    const { error } = await this.client
      .from("scout_notifications")
      .update({ read: true })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to mark notification ${id} as read: ${error.message}`);
    }
  }

  async getUnreadCount(scoutId?: string): Promise<number> {
    let query = this.client
      .from("scout_notifications")
      .select("*", { count: "exact", head: true })
      .eq("read", false);

    if (scoutId) {
      query = query.eq("scout_id", scoutId);
    }

    const { count, error } = await query;
    if (error) {
      throw new Error(`Failed to count unread notifications: ${error.message}`);
    }
    return count || 0;
  }
}
