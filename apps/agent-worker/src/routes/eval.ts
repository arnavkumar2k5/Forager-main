import type { FastifyInstance } from "fastify";
import {
  EvalTraverseRequestSchema,
  EvalDiffRequestSchema,
  EvalVerifyRequestSchema,
  EvalScentRequestSchema,
  TrajectoryStep,
} from "@repo/types";
import {
  executeExplorerStep,
  evaluateExplorerStep,
  extractAtomicPropositionsFromText,
  attachPropositionEmbeddings,
  computePropositionDiff,
  auditClaimVeracity,
  calculateAdaptiveScentInterval,
} from "../agent-core";
import { executeStepObservation } from "../services/step-executor";
import { saveTrajectoryStepSafe } from "../persistence/trajectories";
import { getHistoricalPropositions, savePropositionsSafe } from "../persistence/propositions";

export async function evalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/eval/traverse", async (request, reply) => {
    const parseResult = EvalTraverseRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid eval traverse payload",
        issues: parseResult.error.issues,
      });
    }

    const { goal, currentUrl, history, maxDepth } = parseResult.data;
    const stepNumber = history.length + 1;
    const lastObs = history.length > 0 ? history[history.length - 1]?.observations : undefined;

    const action = await executeExplorerStep({
      goal,
      trajectoryHistory: history,
      currentObservation: lastObs,
      currentUrl,
    });

    const { observation } = await executeStepObservation(action, goal, currentUrl);

    const evaluation = await evaluateExplorerStep({
      goal,
      action,
      observations: observation,
      stepNumber,
      maxSteps: maxDepth,
    });

    const stepTokens = (action.tokensUsed || 0) + (evaluation.tokensUsed || 0);

    const step: TrajectoryStep = {
      stepNumber,
      timestamp: new Date().toISOString(),
      action,
      evaluation,
      observations: observation,
      tokensUsed: stepTokens,
    };

    const executionId =
      typeof (request.headers as Record<string, unknown>)["x-execution-id"] === "string"
        ? (request.headers["x-execution-id"] as string)
        : undefined;

    if (executionId) {
      await saveTrajectoryStepSafe(executionId, step);
    }

    return reply.send({
      step,
      isFinished: action.type === "finish" || evaluation.goalSatisfied || stepNumber >= maxDepth,
      heuristicScore: evaluation.score,
    });
  });

  app.post("/api/v1/eval/diff", async (request, reply) => {
    const parseResult = EvalDiffRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid eval diff payload",
        issues: parseResult.error.issues,
      });
    }

    const startTime = Date.now();
    const { scoutId, rawPayload, sourceUrl, similarityThreshold } = parseResult.data;

    const candidatePropositions = extractAtomicPropositionsFromText(
      rawPayload,
      sourceUrl,
      scoutId
    );

    await attachPropositionEmbeddings(candidatePropositions);

    const { propositions: historicalPropositions, source: historicalSource, warning: histWarning } =
      await getHistoricalPropositions(scoutId);

    const diffResult = await computePropositionDiff(
      candidatePropositions,
      historicalPropositions,
      similarityThreshold
    );

    const novelIds = new Set(
      diffResult.items
        .filter((item) => item.diffType === "novel")
        .map((item) => item.proposition.id)
    );
    const novelPropositions = candidatePropositions.filter((p) => novelIds.has(p.id));

    const persistResult = await savePropositionsSafe(scoutId, novelPropositions);
    const warning = histWarning || persistResult.warning;

    return reply.send({
      diffResult,
      executionDurationMs: Date.now() - startTime,
      historicalSource,
      warning,
    });
  });

  app.post("/api/v1/eval/verify", async (request, reply) => {
    const parseResult = EvalVerifyRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid eval verify payload",
        issues: parseResult.error.issues,
      });
    }

    const { claims, evidenceUrls, minIndependentDomains } = parseResult.data;
    const evidenceList = evidenceUrls.map((url) => ({ url }));

    const audits = await Promise.all(
      claims.map((claim) => auditClaimVeracity(claim, evidenceList, minIndependentDomains))
    );

    const overallPassed = audits.every((a) => a.auditPassed);
    const meanConfidence =
      audits.length > 0
        ? Number((audits.reduce((acc, a) => acc + a.overallConfidence, 0) / audits.length).toFixed(2))
        : 1.0;

    return reply.send({
      audits,
      overallPassed,
      meanConfidence,
    });
  });

  app.post("/api/v1/eval/scent", async (request, reply) => {
    const parseResult = EvalScentRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid eval scent payload",
        issues: parseResult.error.issues,
      });
    }

    const result = calculateAdaptiveScentInterval({
      scoutId: parseResult.data.scoutId,
      baseIntervalMinutes: parseResult.data.baseIntervalMinutes,
      driftScore: parseResult.data.driftScore,
      volatilityFactor: parseResult.data.volatilityFactor,
      consecutiveFailures: parseResult.data.consecutiveFailures,
      stagnantCycles: parseResult.data.stagnantCycles,
      now: new Date(),
    });

    return reply.send(result);
  });
}

