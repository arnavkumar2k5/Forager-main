import { env } from "@repo/config-env";
import { server } from "./server";
import { lockManager } from "./locks";
import { scentScheduler } from "./scheduler";
import { registerRoutes } from "./routes";
import { detectPersistenceMode } from "./persistence/scent";

export {
  inMemoryPropositionStore,
  inMemoryScentMetricsStore,
  clearInMemoryScentMetrics,
  getInMemoryScentMetrics,
  storeInMemoryPropositions,
  getInMemoryPropositions,
  clearInMemoryPropositions,
} from "./persistence/memory-stores";

export {
  setPropositionRepository,
  setTrajectoryRepository,
  setExecutionRepository,
  setScentRepository,
  getPropositionRepoOverride,
  getTrajectoryRepoOverride,
  getExecutionRepoOverride,
  getScentRepoOverride,
} from "./persistence/overrides";

export {
  getHistoricalPropositions,
  savePropositionsSafe,
} from "./persistence/propositions";

export {
  saveTrajectoryStepSafe,
  updateStepOutputDataSafe,
  createRunningStepSafe,
  completeTrajectoryStepSafe,
} from "./persistence/trajectories";

export {
  getScoutSafe,
  createExecutionSafe,
  updateExecutionSafe,
} from "./persistence/executions";

export {
  detectPersistenceMode,
  saveScentMetricSafe,
  updateScoutScheduleSafe,
} from "./persistence/scent";

export {
  executeStepObservation,
  executeScoutWorkflow,
  extractRootDomain,
} from "./services";

export type {
  TrajectorySearchResultItem,
  ScoutWorkflowParams,
  ScoutWorkflowOutcome,
} from "./services";

export { server } from "./server";
export { lockManager, ScoutLockManager } from "./locks";
export { scentScheduler } from "./scheduler";
export {
  registerRoutes,
  healthRoutes,
  scoutRoutes,
  evalRoutes,
  propositionRoutes,
  benchmarkRoutes,
  schedulerRoutes,
} from "./routes";

server.register(registerRoutes);

server.addHook("onClose", async () => {
  scentScheduler.stop();
});

async function main() {
  const port = Number(env.PORT) || 4000;
  try {
    const persistence = await detectPersistenceMode();
    if (persistence.mode === "in_memory_transient") {
      server.log.warn(
        { warning: persistence.warning },
        "Operating in transient in-memory scheduler mode. Schedules will not survive worker restart until remote scent_metrics table is migrated."
      );
    } else {
      server.log.info("Durable database persistence verified for scent metrics and scheduler.");
    }

    server.log.info(
      "Scheduler concurrency note: In-process single-worker locks active. Multiple worker instances require distributed leases."
    );

    const host = process.env.HOST || "127.0.0.1";
    await server.listen({ port, host });
    server.log.info(`Forager Agent Worker running on http://localhost:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

const isRunningUnderNodeTest = Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === "test";

if (!isRunningUnderNodeTest) {
  main();
}
