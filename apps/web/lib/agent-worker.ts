import type { ScoutRunRequest, ScoutRunResponse } from "@repo/types";

const AGENT_WORKER_URL =
  process.env.AGENT_WORKER_URL || "http://localhost:4000";

export class AgentWorkerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AgentWorkerError";
  }
}

export interface WorkerHealthInfo {
  status: string;
  uptime: number;
  uptimeSeconds?: number;
  provider?: string;
  model?: string;
  schedulerRunning?: boolean;
}

export async function checkWorkerHealth(): Promise<WorkerHealthInfo> {
  try {
    const res = await fetch(`${AGENT_WORKER_URL}/health`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      throw new AgentWorkerError(`Health check failed with status ${res.status}`, res.status);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const uptime = typeof data.uptime === "number" ? data.uptime : typeof data.uptimeSeconds === "number" ? data.uptimeSeconds : 0;
    return {
      status: (data.status as string) || "ok",
      uptime,
      uptimeSeconds: uptime,
      provider: data.provider as string | undefined,
      model: data.model as string | undefined,
      schedulerRunning: Boolean(data.schedulerRunning),
    };
  } catch (error) {
    if (error instanceof AgentWorkerError) throw error;
    throw new AgentWorkerError(
      `Failed to connect to agent-worker at ${AGENT_WORKER_URL}: ${(error as Error).message}`,
      undefined,
      error
    );
  }
}

export async function runScoutTask(
  request: ScoutRunRequest
): Promise<ScoutRunResponse> {
  try {
    const res = await fetch(`${AGENT_WORKER_URL}/api/v1/scout/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      cache: "no-store",
    });

    if (!res.ok) {
      const errBody = await res.text();
      let parsedMessage = errBody;
      try {
        const jsonErr = JSON.parse(errBody);
        parsedMessage = jsonErr.error || jsonErr.message || errBody;
      } catch {
        // Fallback to raw response text
      }
      throw new AgentWorkerError(
        `Agent worker returned status ${res.status}: ${parsedMessage}`,
        res.status,
        errBody
      );
    }

    return (await res.json()) as ScoutRunResponse;
  } catch (error) {
    if (error instanceof AgentWorkerError) throw error;
    throw new AgentWorkerError(
      `Failed to dispatch scout run: ${(error as Error).message}`,
      undefined,
      error
    );
  }
}

export async function registerScoutWithScheduler(params: {
  id: string;
  goal: string;
  frequency?: string;
  isActive?: boolean;
}): Promise<void> {
  try {
    await fetch(`${AGENT_WORKER_URL}/api/v1/scheduler/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
    });
  } catch (err) {
    console.warn(
      "Notice: could not register scout with agent worker scheduler:",
      (err as Error).message
    );
  }
}

