import type { FastifyInstance } from "fastify";
import { ScoutRunRequestSchema } from "@repo/types";
import { lockManager } from "../locks";
import { getScoutSafe } from "../persistence/executions";
import { executeScoutWorkflow } from "../services/workflow";

export async function scoutRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/scout/run", async (request, reply) => {
    const parseResult = ScoutRunRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid request payload",
        issues: parseResult.error.issues,
      });
    }

    let { scoutId, query, maxSteps = 10, title, goal, searchQueries } = parseResult.data;

    if (scoutId) {
      const acquired = await lockManager.acquire(scoutId, "manual");
      if (!acquired) {
        return reply.status(409).send({
          error: "Scout execution conflict",
          message: `Scout ${scoutId} is currently executing. Concurrent runs are rejected.`,
        });
      }
    }

    try {
      if (scoutId) {
        const scoutLookup = await getScoutSafe(scoutId);
        if (!scoutLookup.found) {
          return reply.status(404).send({
            error: `Scout not found: ${scoutId}`,
          });
        }
        if (scoutLookup.scout) {
          title = title || (scoutLookup.scout.title as string) || undefined;
          goal =
            goal ||
            (scoutLookup.scout.goal as string) ||
            (scoutLookup.scout.description as string) ||
            undefined;
          if (!searchQueries || searchQueries.length === 0) {
            if (Array.isArray(scoutLookup.scout.search_queries)) {
              searchQueries = scoutLookup.scout.search_queries as string[];
            }
          }
        }
        if (!query && scoutLookup.scout) {
          query =
            goal ||
            (searchQueries && searchQueries[0]) ||
            title ||
            (scoutLookup.scout.description as string) ||
            "Analyze latest updates";
        }
      }

      if (!query) {
        return reply.status(400).send({
          error: "Query is required when not derivable from scout",
        });
      }

      const outcome = await executeScoutWorkflow({
        scoutId,
        query,
        maxSteps,
        title,
        goal,
        searchQueries,
      });

      if (outcome.httpStatus && outcome.httpStatus >= 400) {
        return reply.status(outcome.httpStatus).send(outcome);
      }

      return reply.send(outcome);
    } finally {
      if (scoutId) {
        await lockManager.release(scoutId);
      }
    }
  });
}

