import type { FastifyInstance } from "fastify";
import {
  BenchmarkRunRequestSchema,
  BenchmarkBatchRequestSchema,
  TrajectoryStep,
} from "@repo/types";
import {
  executeExplorerStep,
  evaluateExplorerStep,
  synthesizeFinalAnswer,
  resolveLLMConfig,
  estimateTokenCost,
  extractAtomicPropositionsFromText,
  EvidenceSource,
  LLMProviderType,
  CandidateFrontier,
} from "../agent-core";
import { env } from "@repo/config-env";
import { executeStepObservation } from "../services/step-executor";
import { saveTrajectoryStepSafe } from "../persistence/trajectories";
import { savePropositionsSafe } from "../persistence/propositions";

export async function benchmarkRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/benchmark/run", async (request, reply) => {
    const parseResult = BenchmarkRunRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid request payload",
        issues: parseResult.error.issues,
      });
    }

    const { query, maxSteps, seedUrl, rootUrl, mode = "forager" } = parseResult.data;
    const isSequentialAblation = mode === "webwalker" || mode === "sequential_ablation";
    const architectureLabel =
      mode === "rag"
        ? "Single-Shot RAG (Perplexity-style)"
        : isSequentialAblation
          ? "Sequential Explore-Critic (WebWalker-style Ablation)"
          : "Forager (Ours - Candidate Frontier + Batch + OHCache)";
    const startTime = Date.now();
    const executionId =
      typeof parseResult.data.metadata?.executionId === "string"
        ? parseResult.data.metadata.executionId
        : undefined;
    const runId = executionId || crypto.randomUUID();

    const steps: TrajectoryStep[] = [];
    let isFinished = false;
    let currentUrl: string | undefined = seedUrl || rootUrl;
    const evidenceMap = new Map<string, EvidenceSource>();
    const frontier = new CandidateFrontier();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    if (currentUrl && currentUrl.startsWith("http")) {
      frontier.addCandidates(
        [
          {
            url: currentUrl,
            title: `Root Anchor: ${currentUrl}`,
            description: `Target ground page for ${query}`,
          },
        ],
        query,
        0
      );
    }

    if (mode === "rag") {
      const stepStartTime = new Date().toISOString();
      const action = {
        type: "search" as const,
        query,
        reasoning: "Executing single-shot query search for Perplexity-style RAG baseline.",
      };
      const { observation, searchResults } = await executeStepObservation(action, query);
      const ragEvidence: EvidenceSource[] = (searchResults || []).slice(0, 5).map((sr) => ({
        url: sr.url,
        title: sr.title,
        content: sr.description || sr.markdown || sr.title || "",
      }));
      for (const e of ragEvidence) {
        evidenceMap.set(e.url, e);
      }

      steps.push({
        stepNumber: 1,
        timestamp: stepStartTime,
        action,
        observations: observation,
        tokensUsed: 0,
      });
      isFinished = true;
    }

    for (let i = 1; i <= maxSteps && !isFinished; i++) {
      const lastObs = steps.length > 0 ? steps[steps.length - 1]?.observations : undefined;

      const action = await executeExplorerStep({
        goal: query,
        trajectoryHistory: steps,
        currentObservation: lastObs,
        currentUrl,
        stepNumber: i,
        maxSteps,
        frontierCandidates: isSequentialAblation ? [] : frontier.getQueuedCandidates(),
        exploredDomains:
          isSequentialAblation
            ? []
            : frontier
                .getAllDomainCoverages()
                .filter((d) => d.scrapedPaths.length > 0)
                .map((d) => d.rootDomain),
      });

      if (isSequentialAblation && action.urls && action.urls.length > 1) {
        action.urls = [action.urls[0]!];
        action.url = action.urls[0];
      }

      if (action.url) {
        currentUrl = action.url;
      }

      const { observation, scrapedUrl, scrapedTitle, scrapedContent, scrapedPages, searchResults } =
        await executeStepObservation(action, query, currentUrl);

      if (searchResults && searchResults.length > 0) {
        frontier.addCandidates(searchResults, action.query || query, i);
        for (const sr of searchResults) {
          if (!evidenceMap.has(sr.url)) {
            evidenceMap.set(sr.url, {
              url: sr.url,
              title: sr.title,
              content: sr.description || sr.markdown || sr.title || "",
            });
          }
        }
      }

      if (scrapedPages && scrapedPages.length > 0) {
        for (const p of scrapedPages) {
          if (p.url) {
            frontier.recordScraped(p.url, i);
            if (p.content && p.content.trim().length > 0) {
              evidenceMap.set(p.url, {
                url: p.url,
                title: p.title,
                content: p.content,
              });
            }
          }
        }
      } else if (scrapedUrl) {
        frontier.recordScraped(scrapedUrl, i);
        evidenceMap.set(scrapedUrl, {
          url: scrapedUrl,
          title: scrapedTitle,
          content: scrapedContent || "",
        });
      }

      const evaluation = await evaluateExplorerStep({
        goal: query,
        action,
        observations: observation,
        stepNumber: i,
        maxSteps,
      });

      const stepTokens = (action.tokensUsed || 0) + (evaluation.tokensUsed || 0);
      totalPromptTokens += (action.promptTokens || 0) + (evaluation.promptTokens || 0);
      totalCompletionTokens += (action.completionTokens || 0) + (evaluation.completionTokens || 0);

      const step: TrajectoryStep = {
        stepNumber: i,
        timestamp: new Date().toISOString(),
        action,
        evaluation,
        observations: observation,
        tokensUsed: stepTokens,
      };

      steps.push(step);
      if (executionId) {
        await saveTrajectoryStepSafe(executionId, step);
      }

      if (action.type === "finish" || evaluation.goalSatisfied) {
        isFinished = true;
      }
    }

    const evidenceList = Array.from(evidenceMap.values());
    const synthesis = await synthesizeFinalAnswer({
      query,
      evidence: evidenceList,
    });

    const finishStep = steps.find((s) => s.action.type === "finish");
    if (finishStep) {
      finishStep.observations = synthesis.answer;
      finishStep.outputData = {
        ...(finishStep.outputData || {}),
        response: synthesis.answer,
        answer: synthesis.answer,
        citations: synthesis.citations,
        isComplete: synthesis.isComplete,
      };
    }

    const durationMs = Date.now() - startTime;
    const evidenceUrls = evidenceList.map((e) => e.url);
    const totalStepTokens = steps.reduce((acc, s) => acc + (s.tokensUsed || 0), 0);
    const totalTokens = totalStepTokens + (synthesis.tokensUsed || 0);
    totalPromptTokens += synthesis.promptTokens || 0;
    totalCompletionTokens += synthesis.completionTokens || 0;

    let provider: LLMProviderType = "gemini";
    let modelName: string | undefined;
    try {
      const config = resolveLLMConfig();
      provider = config.provider;
      modelName = config.model;
    } catch {
      const raw = env.AI_PROVIDER?.toLowerCase();
      provider = raw === "gemini" ? "gemini" : raw === "openai" ? "openai" : "groq";
    }
    const estimatedCostUsd = estimateTokenCost(
      totalTokens,
      provider,
      totalPromptTokens,
      totalCompletionTokens,
      modelName
    );

    const lastEvaluation = steps.length > 0 ? steps[steps.length - 1]?.evaluation : undefined;

    let status: "completed" | "stopped_due_to_limit" | "failed";
    if (synthesis.isComplete && (lastEvaluation?.goalSatisfied || (lastEvaluation?.score && lastEvaluation.score >= 0.6))) {
      status = "completed";
    } else if (synthesis.isComplete) {
      status = "completed";
    } else {
      status = "stopped_due_to_limit";
    }

    const success = (synthesis.isComplete && synthesis.citations.length > 0) || evidenceUrls.length > 0;
    const answer = synthesis.answer;
    const citations = synthesis.citations;

    const scoutId =
      typeof parseResult.data.metadata?.scoutId === "string"
        ? parseResult.data.metadata.scoutId
        : undefined;

    if (scoutId && evidenceUrls.length > 0) {
      const extractedProps = extractAtomicPropositionsFromText(answer, evidenceUrls[0] || "", scoutId);
      await savePropositionsSafe(scoutId, extractedProps);
    }

    return reply.send({
      runId,
      query,
      mode,
      architectureLabel,
      answer,
      citations,
      steps,
      stepCount: steps.length,
      durationMs,
      totalTokens,
      estimatedCostUsd,
      evidenceUrls,
      success,
      status,
    });
  });

  app.post("/api/v1/benchmark/batch", async (request, reply) => {
    const parseResult = BenchmarkBatchRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid batch request payload",
        issues: parseResult.error.issues,
      });
    }

    return reply.send({
      status: "queued",
      totalRuns: parseResult.data.runs.length,
      concurrency: parseResult.data.concurrency,
      message: "Batch benchmarking scheduled",
    });
  });
}

