import { SupabaseClient } from "@supabase/supabase-js";
import { ScentMetric } from "@repo/types";

export interface ScoutScheduleRecord {
  id: string;
  goal: string;
  frequency: string | null;
  isActive: boolean;
  lastRunAt: string | null;
  consecutiveFailures: number;
}

export interface UpdateScoutScheduleParams {
  lastRunAt?: string;
  consecutiveFailures?: number;
}

export class ScentRepository {
  constructor(private client: SupabaseClient) {}

  async verifySchemaAccess(): Promise<boolean> {
    try {
      const { error } = await this.client
        .from("scent_metrics")
        .select("id")
        .limit(1);

      return !error;
    } catch {
      return false;
    }
  }

  async recordMetric(metric: ScentMetric): Promise<void> {
    const { error } = await this.client.from("scent_metrics").insert({
      scout_id: metric.scoutId,
      drift_score: metric.driftScore,
      volatility_factor: metric.volatilityFactor,
      base_interval_minutes: metric.baseIntervalMinutes,
      computed_interval_minutes: metric.computedIntervalMinutes,
      next_run_at: metric.nextRunAt,
      recorded_at: metric.recordedAt || new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Failed to record scent metric: ${error.message}`);
    }
  }

  async getLatestMetric(scoutId: string): Promise<ScentMetric | null> {
    const { data, error } = await this.client
      .from("scent_metrics")
      .select("*")
      .eq("scout_id", scoutId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch latest scent metric for scout ${scoutId}: ${error.message}`);
    }

    if (!data) return null;

    return {
      scoutId: data.scout_id,
      driftScore: data.drift_score,
      volatilityFactor: data.volatility_factor,
      baseIntervalMinutes: data.base_interval_minutes,
      computedIntervalMinutes: data.computed_interval_minutes,
      nextRunAt: new Date(data.next_run_at).toISOString(),
      recordedAt: new Date(data.recorded_at).toISOString(),
    };
  }

  async getActiveScouts(): Promise<ScoutScheduleRecord[]> {
    const { data, error } = await this.client
      .from("scouts")
      .select("id, goal, frequency, is_active, last_run_at, consecutive_failures")
      .eq("is_active", true);

    if (error) {
      throw new Error(`Failed to fetch active scouts: ${error.message}`);
    }

    return (data || []).map((row) => ({
      id: row.id,
      goal: row.goal || "",
      frequency: row.frequency || null,
      isActive: row.is_active ?? true,
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      consecutiveFailures: row.consecutive_failures || 0,
    }));
  }

  async updateScoutSchedule(scoutId: string, params: UpdateScoutScheduleParams): Promise<void> {
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (params.lastRunAt !== undefined) {
      updatePayload.last_run_at = params.lastRunAt;
    }
    if (params.consecutiveFailures !== undefined) {
      updatePayload.consecutive_failures = params.consecutiveFailures;
    }

    const { error } = await this.client
      .from("scouts")
      .update(updatePayload)
      .eq("id", scoutId);

    if (error) {
      throw new Error(`Failed to update scout schedule for ${scoutId}: ${error.message}`);
    }
  }
}
