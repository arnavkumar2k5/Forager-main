import { SupabaseClient } from "@supabase/supabase-js";
import { TrajectoryStep } from "@repo/types";

export interface CreateRunningStepParams {
  executionId: string;
  stepNumber: number;
  stepType: string;
  description: string;
  inputData?: Record<string, unknown>;
  startedAt?: string;
}

export interface CompleteStepParams {
  executionId: string;
  stepNumber: number;
  stepType?: string;
  description?: string;
  outputData: Record<string, unknown>;
  status?: "completed" | "failed";
  errorMessage?: string;
}

export class TrajectoryRepository {
  constructor(private client: SupabaseClient) {}

  async saveSteps(executionId: string, steps: TrajectoryStep[]): Promise<void> {
    if (steps.length === 0) return;
    const rows = steps.map((step) => {
      const outputData: Record<string, unknown> = {
        evaluation: step.evaluation,
        observations: step.observations,
        tokensUsed: step.tokensUsed,
        ...(step.outputData || {}),
      };

      const actionType = step.action.type as string;
      const stepType = actionType === "navigate" ? "scrape" : actionType;

      let description = step.action.reasoning;
      if (actionType === "search") {
        description = `searchWeb: ${step.action.query || "web search"}`;
        const query = step.action.query || (outputData.query as string) || "";
        outputData.query = query;
        if (step.searchResults && step.searchResults.length > 0) {
          outputData.results = step.searchResults;
          outputData.searchResults = step.searchResults;
          outputData.count = step.searchResults.length;
        } else if (outputData.results) {
          outputData.searchResults = outputData.searchResults || outputData.results;
          outputData.count = Array.isArray(outputData.results) ? outputData.results.length : 0;
        } else {
          outputData.results = [];
          outputData.searchResults = [];
          outputData.count = 0;
        }
      } else if (actionType === "navigate" || actionType === "scrape") {
        const url = step.action.url || (outputData.url as string) || "target page";
        description = `scrapeWebsite: ${url}`;
        outputData.url = url;
        if (step.outputData?.title) outputData.title = step.outputData.title;
        if (step.outputData?.content) outputData.content = step.outputData.content;
        if (step.outputData?.markdown) outputData.markdown = step.outputData.markdown;
        if (step.outputData?.screenshot) outputData.screenshot = step.outputData.screenshot;
      } else if (actionType === "finish") {
        outputData.response = step.outputData?.response || step.action.reasoning;
        outputData.answer = step.outputData?.answer || step.action.reasoning;
      }

      return {
        execution_id: executionId,
        step_number: step.stepNumber,
        step_type: stepType,
        description,
        input_data: {
          action: step.action,
          query: step.action.query,
          url: step.action.url,
        },
        output_data: outputData,
        status: "completed" as const,
        started_at: step.timestamp,
        completed_at: new Date().toISOString(),
      };
    });

    const { error } = await this.client.from("scout_execution_steps").insert(rows);

    if (error) {
      throw new Error(`Failed to save trajectory steps: ${error.message}`);
    }
  }

  async saveStep(executionId: string, step: TrajectoryStep): Promise<void> {
    const { data: existing } = await this.client
      .from("scout_execution_steps")
      .select("id")
      .eq("execution_id", executionId)
      .eq("step_number", step.stepNumber)
      .limit(1);

    const stepType =
      step.action.type === "navigate" ? "scrape" : (step.action.type as any);
    const description = step.action.reasoning || `Step ${step.stepNumber}: ${step.action.type}`;
    const outputData: Record<string, unknown> = {
      ...(step.outputData || {}),
      evaluation: step.evaluation,
      observations: step.observations,
      tokensUsed: step.tokensUsed,
    };

    if (existing && existing.length > 0 && existing[0]?.id) {
      const { error } = await this.client
        .from("scout_execution_steps")
        .update({
          step_type: stepType,
          description,
          output_data: outputData,
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", existing[0].id);

      if (error) {
        throw new Error(`Failed to update trajectory step: ${error.message}`);
      }
      return;
    }

    await this.saveSteps(executionId, [step]);
  }

  async createRunningStep(params: CreateRunningStepParams): Promise<void> {
    const { data: existing } = await this.client
      .from("scout_execution_steps")
      .select("id")
      .eq("execution_id", params.executionId)
      .eq("step_number", params.stepNumber)
      .limit(1);

    if (existing && existing.length > 0 && existing[0]?.id) {
      await this.client
        .from("scout_execution_steps")
        .update({
          step_type: params.stepType,
          description: params.description,
          input_data: params.inputData || {},
          status: "running",
          started_at: params.startedAt || new Date().toISOString(),
        })
        .eq("id", existing[0].id);
      return;
    }

    const row = {
      execution_id: params.executionId,
      step_number: params.stepNumber,
      step_type: params.stepType,
      description: params.description,
      input_data: params.inputData || {},
      output_data: {},
      status: "running" as const,
      started_at: params.startedAt || new Date().toISOString(),
    };
    const { error } = await this.client.from("scout_execution_steps").insert(row);
    if (error) {
      throw new Error(`Failed to create running step: ${error.message}`);
    }
  }

  async completeStep(params: CompleteStepParams): Promise<void> {
    const updatePayload: Record<string, unknown> = {
      status: params.status || "completed",
      completed_at: new Date().toISOString(),
      output_data: params.outputData,
    };
    if (params.stepType) updatePayload.step_type = params.stepType;
    if (params.description) updatePayload.description = params.description;
    if (params.errorMessage !== undefined) updatePayload.error_message = params.errorMessage;

    const { error, count } = await this.client
      .from("scout_execution_steps")
      .update(updatePayload, { count: "exact" })
      .eq("execution_id", params.executionId)
      .eq("step_number", params.stepNumber);

    if (error) {
      throw new Error(`Failed to complete step: ${error.message}`);
    }

    if (count === 0) {
      await this.client.from("scout_execution_steps").insert({
        execution_id: params.executionId,
        step_number: params.stepNumber,
        step_type: params.stepType || "tool_call",
        description: params.description || "Completed step",
        input_data: {},
        output_data: params.outputData,
        status: params.status || "completed",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_message: params.errorMessage || null,
      });
    }
  }

  async updateStepOutputData(
    executionId: string,
    stepNumber: number,
    additionalOutputData: Record<string, unknown>
  ): Promise<void> {
    const { data, error: fetchError } = await this.client
      .from("scout_execution_steps")
      .select("output_data")
      .eq("execution_id", executionId)
      .eq("step_number", stepNumber)
      .single();

    if (fetchError || !data) return;

    const existingOutput = (data.output_data as Record<string, unknown>) || {};
    const mergedOutput = { ...existingOutput, ...additionalOutputData };

    await this.client
      .from("scout_execution_steps")
      .update({ output_data: mergedOutput })
      .eq("execution_id", executionId)
      .eq("step_number", stepNumber);
  }

  async getStepsByExecutionId(executionId: string): Promise<TrajectoryStep[]> {
    const { data, error } = await this.client
      .from("scout_execution_steps")
      .select("*")
      .eq("execution_id", executionId)
      .order("step_number", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch trajectory steps: ${error.message}`);
    }

    return (data || []).map((row) => ({
      stepNumber: row.step_number,
      timestamp:
        row.started_at instanceof Date
          ? row.started_at.toISOString()
          : row.started_at || new Date().toISOString(),
      action: row.input_data?.action,
      evaluation: row.output_data?.evaluation,
      observations: row.output_data?.observations,
      tokensUsed: row.output_data?.tokensUsed || 0,
      searchResults: row.output_data?.searchResults || row.output_data?.results,
      outputData: row.output_data,
    }));
  }
}
