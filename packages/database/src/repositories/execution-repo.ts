import { SupabaseClient } from "@supabase/supabase-js";

export interface CreateExecutionParams {
  id: string;
  scoutId: string;
  status: "running" | "completed" | "failed";
  startedAt?: string;
}

export interface UpdateExecutionParams {
  status: "running" | "completed" | "failed";
  completedAt?: string;
  errorMessage?: string | null;
  summaryText?: string | null;
  resultsSummary?: Record<string, unknown> | null;
}

export class ExecutionRepository {
  constructor(private client: SupabaseClient) {}

  async findScoutById(scoutId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client
      .from("scouts")
      .select("*")
      .eq("id", scoutId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch scout ${scoutId}: ${error.message}`);
    }
    return data;
  }

  async createExecution(params: CreateExecutionParams): Promise<void> {
    const { error } = await this.client.from("scout_executions").insert({
      id: params.id,
      scout_id: params.scoutId,
      status: params.status,
      started_at: params.startedAt || new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Failed to create scout execution: ${error.message}`);
    }
  }

  async updateExecution(id: string, params: UpdateExecutionParams): Promise<void> {
    const { error } = await this.client
      .from("scout_executions")
      .update({
        status: params.status,
        completed_at: params.completedAt || new Date().toISOString(),
        error_message: params.errorMessage ?? null,
        summary_text: params.summaryText ?? null,
        results_summary: params.resultsSummary ?? null,
      })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to update scout execution ${id}: ${error.message}`);
    }
  }

  async getExecutionById(id: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client
      .from("scout_executions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch execution ${id}: ${error.message}`);
    }
    return data;
  }
}
