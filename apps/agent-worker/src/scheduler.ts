import { AdaptiveScentScheduler } from "./agent-core";
import { lockManager } from "./locks";
import { executeScoutWorkflow } from "./services/workflow";
import { saveScentMetricSafe, updateScoutScheduleSafe } from "./persistence/scent";

export const scentScheduler = new AdaptiveScentScheduler({
  lock: lockManager,
  onExecuteScout: async (scout) => {
    try {
      const outcome = await executeScoutWorkflow({
        scoutId: scout.id,
        query: scout.goal,
        maxSteps: 10,
      });

      return {
        success: outcome.success && outcome.status !== "failed",
        status: outcome.status,
        driftScore: outcome.driftScore ?? 0,
        volatilityFactor: 1.0,
        error: outcome.error,
      };
    } catch (err) {
      return {
        success: false,
        status: "failed",
        error: (err as Error).message,
      };
    }
  },
  onRecordMetric: async (metric) => {
    await saveScentMetricSafe(metric);
    await updateScoutScheduleSafe(metric.scoutId, {
      lastRunAt: metric.recordedAt,
      consecutiveFailures: metric.consecutiveFailures,
    });
  },
});

