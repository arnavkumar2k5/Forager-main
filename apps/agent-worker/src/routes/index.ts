import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./health";
import { scoutRoutes } from "./scout";
import { evalRoutes } from "./eval";
import { propositionRoutes } from "./propositions";
import { benchmarkRoutes } from "./benchmark";
import { schedulerRoutes } from "./scheduler";
import { notificationRoutes } from "./notifications";

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(scoutRoutes);
  await app.register(evalRoutes);
  await app.register(propositionRoutes);
  await app.register(benchmarkRoutes);
  await app.register(schedulerRoutes);
  await app.register(notificationRoutes);
}

export {
  healthRoutes,
  scoutRoutes,
  evalRoutes,
  propositionRoutes,
  benchmarkRoutes,
  schedulerRoutes,
  notificationRoutes,
};

