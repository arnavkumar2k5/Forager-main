import type { FastifyInstance } from "fastify";
import { detectPersistenceMode } from "../persistence/scent";
import { lockManager } from "../locks";
import { scentScheduler } from "../scheduler";

export async function schedulerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/scheduler/status", async (_request, reply) => {
    const persistence = await detectPersistenceMode();
    const status = scentScheduler.getStatus();
    const schedules = scentScheduler.getScheduledScouts().map((s) => ({
      scoutId: s.scoutId,
      goal: s.goal,
      frequency: s.frequency,
      baseIntervalMinutes: s.baseIntervalMinutes,
      computedIntervalMinutes: s.computedIntervalMinutes,
      nextRunAt: s.nextRunAt.toISOString(),
      lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
      consecutiveFailures: s.consecutiveFailures,
      stagnantCycles: s.stagnantCycles,
      isActive: s.isActive,
    }));

    return reply.send({
      status: status.isRunning ? "running" : "stopped",
      persistenceMode: persistence.mode,
      warning: persistence.warning,
      concurrencyNotice:
        "Single-worker in-process locking only. Multiple worker replicas require distributed locks or leases.",
      activeLocks: await lockManager.getActiveLocks(),
      registeredScoutsCount: status.registeredScoutsCount,
      activeScoutsCount: status.activeScoutsCount,
      clockTime: status.clockTime,
      schedules,
    });
  });

  app.post("/api/v1/scheduler/tick", async (_request, reply) => {
    const executed = await scentScheduler.tick();
    return reply.send({
      executedScoutIds: executed,
      executedCount: executed.length,
    });
  });

  app.post("/api/v1/scheduler/register", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!body || typeof body.id !== "string" || typeof body.goal !== "string") {
      return reply.status(400).send({ error: "id and goal are required" });
    }

    scentScheduler.registerScout({
      id: body.id,
      goal: body.goal,
      frequency: (body.frequency as string) || "daily",
      isActive: body.isActive !== false,
      nextRunAt: body.nextRunAt ? new Date(body.nextRunAt as string) : undefined,
    });

    return reply.send({ success: true, scoutId: body.id });
  });
}

