import type { FastifyInstance } from "fastify";
import { env } from "@repo/config-env";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "forager-agent-worker",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      uptimeSeconds: Math.floor(process.uptime()),
      provider: env.AI_PROVIDER || "gemini",
      model: env.AI_MODEL || "gemini-3.5-flash-lite",
      schedulerRunning: true,
    };
  });
}


