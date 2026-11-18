import type { FastifyInstance } from "fastify";
import { PropositionSearchRequestSchema, Proposition } from "@repo/types";
import {
  generateGeminiEmbedding,
  cosineSimilarity,
  isValidEmbedding,
  EXPECTED_EMBEDDING_DIM,
} from "../agent-core";
import { env } from "@repo/config-env";
import { getServiceClient, matchPropositions } from "@repo/database";
import { inMemoryPropositionStore, getInMemoryPropositions } from "../persistence/memory-stores";

export async function propositionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/propositions/search", async (request, reply) => {
    const parseResult = PropositionSearchRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid proposition search payload",
        issues: parseResult.error.issues,
      });
    }

    const { query, scoutId, matchThreshold = 0.78, matchCount = 10 } = parseResult.data;

    let queryEmbedding: number[];
    try {
      queryEmbedding = await generateGeminiEmbedding(query);
    } catch (err) {
      app.log.warn({ err }, "Query embedding generation failed; semantic search unavailable");
      return reply.status(503).send({
        error: `Embedding generation failed: ${(err as Error).message}`,
      });
    }

    const supabaseUrl = env.SUPABASE_URL;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const isDbConfigured =
      supabaseUrl &&
      serviceRoleKey &&
      !supabaseUrl.includes("your-project") &&
      !serviceRoleKey.includes("your-supabase");

    if (isDbConfigured) {
      try {
        const client = getServiceClient();
        const dbMatches = await matchPropositions(
          client,
          queryEmbedding,
          matchThreshold,
          matchCount,
          scoutId
        );
        const matchesWithMethod = dbMatches.map((m) => ({
          ...m,
          similarityMethod: "vector_cosine" as const,
        }));
        const dbMethod: "vector_cosine" | "none" =
          dbMatches.length > 0 ? "vector_cosine" : "none";

        return reply.send({
          query,
          matches: matchesWithMethod,
          source: "database",
          dimensions: EXPECTED_EMBEDDING_DIM,
          similarityMethod: dbMethod,
        });
      } catch (err) {
        app.log.warn({ err }, "Database match_propositions RPC failed; falling back to in-memory store");
      }
    }

    const candidates: Proposition[] = [];
    if (scoutId) {
      candidates.push(...getInMemoryPropositions(scoutId));
    } else {
      for (const list of inMemoryPropositionStore.values()) {
        candidates.push(...list);
      }
    }

    const scoredMatches = candidates.map((p) => {
      let similarity = 0;
      let method: "vector_cosine" | "lexical_jaccard" = "lexical_jaccard";

      if (p.embedding && isValidEmbedding(p.embedding)) {
        similarity = cosineSimilarity(queryEmbedding, p.embedding);
        method = "vector_cosine";
      } else {
        const cleanA = query.toLowerCase().replace(/[^\w\s]/g, " ").trim();
        const cleanB = p.content.toLowerCase().replace(/[^\w\s]/g, " ").trim();
        const setA = new Set(cleanA.split(/\s+/).filter(Boolean));
        const setB = new Set(cleanB.split(/\s+/).filter(Boolean));
        if (setA.size > 0 && setB.size > 0) {
          const intersection = new Set([...setA].filter((x) => setB.has(x)));
          const union = new Set([...setA, ...setB]);
          similarity = union.size > 0 ? intersection.size / union.size : 0;
        }
        method = "lexical_jaccard";
      }

      return {
        id: p.id,
        scoutId: p.scoutId,
        content: p.content,
        similarity: Number(similarity.toFixed(4)),
        similarityMethod: method,
      };
    });

    const filteredMatches = scoredMatches
      .filter((m) => m.similarity >= matchThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, matchCount);

    let overallMethod: "vector_cosine" | "lexical_jaccard" | "mixed" | "none" = "none";
    if (filteredMatches.length > 0) {
      const hasVector = filteredMatches.some((m) => m.similarityMethod === "vector_cosine");
      const hasLexical = filteredMatches.some((m) => m.similarityMethod === "lexical_jaccard");
      if (hasVector && hasLexical) {
        overallMethod = "mixed";
      } else if (hasVector) {
        overallMethod = "vector_cosine";
      } else {
        overallMethod = "lexical_jaccard";
      }
    }

    return reply.send({
      query,
      matches: filteredMatches,
      source: "in_memory_fallback",
      dimensions: EXPECTED_EMBEDDING_DIM,
      similarityMethod: overallMethod,
      warning: isDbConfigured
        ? "Database match_propositions unavailable; operated with in-memory semantic fallback."
        : "Database unconfigured; operated with in-memory semantic fallback.",
    });
  });
}

