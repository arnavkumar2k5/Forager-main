import crypto from "node:crypto";
import { env } from "@repo/config-env";
import { getServiceClient } from "@repo/database";
import type { TrajectoryStep, Proposition, VeracityAudit } from "@repo/types";
import {
  executeExplorerStep,
  evaluateExplorerStep,
  extractAtomicPropositionsFromText,
  computePropositionDiff,
  calculateAdaptiveScentInterval,
  resolveLLMConfig,
  estimateTokenCost,
  synthesizeFinalAnswer,
  EvidenceSource,
  attachPropositionEmbeddings,
  frequencyToMinutes,
  LLMProviderType,
  CandidateFrontier,
  classifyScoutIntent,
  extractDirectUrls,
  canonicalizeUrl,
  auditClaimVeracity,
} from "../agent-core";
import { server } from "../server";
import {
  getScoutSafe,
  createExecutionSafe,
  updateExecutionSafe,
} from "../persistence/executions";
import {
  createRunningStepSafe,
  completeTrajectoryStepSafe,
  updateStepOutputDataSafe,
  saveTrajectoryStepSafe,
} from "../persistence/trajectories";
import {
  getHistoricalPropositions,
  savePropositionsSafe,
  updatePropositionStatusSafe,
} from "../persistence/propositions";
import {
  saveScentMetricSafe,
  updateScoutScheduleSafe,
} from "../persistence/scent";
import { saveVeracityAuditsSafe } from "../persistence/veracity";
import { executeStepObservation } from "./step-executor";
import { scentScheduler } from "../scheduler";
import { sendNotification } from "./notifications";

export interface ScoutWorkflowParams {
  scoutId?: string;
  query: string;
  maxSteps?: number;
  title?: string;
  goal?: string;
  searchQueries?: string[];
}

export interface ScoutWorkflowOutcome {
  executionId: string;
  scoutId?: string;
  query: string;
  answer?: string;
  citations: string[];
  isComplete?: boolean;
  success: boolean;
  status: "completed" | "incomplete" | "failed";
  missingInformation?: string;
  error?: string;
  steps: TrajectoryStep[];
  stepCount: number;
  durationMs: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  evidenceUrls?: string[];
  propositions?: {
    extractedCount: number;
    novelCount: number;
    redundantCount: number;
    contradictionCount: number;
    persistedCount: number;
    historicalSource?: "database" | "in_memory_fallback";
    warning?: string;
  };
  diffSummary?: {
    isBaseline: boolean;
    novelCount: number;
    updatedCount: number;
    redundantCount: number;
    driftScore: number;
    novelItems: string[];
    updatedItems: string[];
    redundantItems: string[];
  };
  driftScore?: number;
  httpStatus?: number;
}

export function extractRootDomain(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function executeScoutWorkflow(params: ScoutWorkflowParams): Promise<ScoutWorkflowOutcome> {
  const { scoutId, query, maxSteps = 10 } = params;
  let { title, goal, searchQueries } = params;
  const executionId = crypto.randomUUID();
  const startTime = Date.now();

  let scoutFrequency = "daily";
  if (scoutId) {
    const scoutLookup = await getScoutSafe(scoutId);
    if (scoutLookup.found && scoutLookup.scout) {
      if (scoutLookup.scout.frequency) {
        scoutFrequency = scoutLookup.scout.frequency as string;
      }
      title = title || (scoutLookup.scout.title as string) || undefined;
      goal = goal || (scoutLookup.scout.goal as string) || undefined;
      if (!searchQueries || searchQueries.length === 0) {
        if (Array.isArray(scoutLookup.scout.search_queries)) {
          searchQueries = scoutLookup.scout.search_queries as string[];
        }
      }
    }
  }

  await createExecutionSafe({
    id: executionId,
    scoutId,
    status: "running",
    startedAt: new Date().toISOString(),
  });

  const steps: TrajectoryStep[] = [];
  let isFinished = false;
  let currentUrl: string | undefined = undefined;
  const evidenceMap = new Map<string, EvidenceSource>();
  const visitedDomains = new Set<string>();
  const frontier = new CandidateFrontier();
  let executionError: Error | null = null;
  let currentRunningStepNumber: number | null = null;

  const combinedSeedText = `${query || ""} ${goal || ""}`;
  const directUrls = extractDirectUrls(combinedSeedText);
  if (directUrls.length > 0 && directUrls[0]) {
    currentUrl = directUrls[0];
    frontier.addCandidates(
      directUrls.map((u) => ({
        url: u,
        title: `Direct Canonical Target: ${u}`,
        description: `Direct canonical link specified in scout goal or query: ${title || query}`,
      })),
      query || goal || "",
      0
    );
  }

  try {
    for (let i = 1; i <= maxSteps && !isFinished; i++) {
      const stepStartTime = new Date().toISOString();
      const lastObs = steps.length > 0 ? steps[steps.length - 1]?.observations : undefined;

      const queuedCandidates = frontier.getQueuedCandidates();
      const coveredDomains = frontier
        .getAllDomainCoverages()
        .filter((d) => d.scrapedPaths.length > 0)
        .map((d) => d.rootDomain);

      const action = await executeExplorerStep({
        goal: goal || query,
        title,
        suggestedQueries: searchQueries,
        trajectoryHistory: steps,
        currentObservation: lastObs,
        currentUrl,
        stepNumber: i,
        maxSteps,
        frontierCandidates: queuedCandidates,
        exploredDomains: coveredDomains,
      });

      if (action.url) {
        currentUrl = action.url;
        const dom = extractRootDomain(action.url);
        if (dom) visitedDomains.add(dom);
      }
      if (action.urls) {
        for (const u of action.urls) {
          const dom = extractRootDomain(u);
          if (dom) visitedDomains.add(dom);
        }
      }

      const stepType = action.type === "navigate" ? "scrape" : action.type;
      let description = action.reasoning;
      let inputData: Record<string, unknown> = { action };

      const navigateTargets = (
        action.urls && action.urls.length > 0 ? action.urls : [action.url || currentUrl || ""]
      ).filter(Boolean);

      if (action.type === "search") {
        const q = action.query || query || goal;
        description = `searchWeb: ${q}`;
        inputData = { query: q, action };
      } else if (action.type === "navigate") {
        if (navigateTargets.length > 1) {
          const domainSummary = navigateTargets
            .map((u) => extractRootDomain(u) || u)
            .slice(0, 3)
            .join(", ");
          description = `scrapeWebsites (${navigateTargets.length}): ${domainSummary}`;
          inputData = { urls: navigateTargets, action };
        } else {
          const u = navigateTargets[0] || action.url || currentUrl || "";
          description = `scrapeWebsite: ${u}`;
          inputData = { url: u, action };
        }
      }

      currentRunningStepNumber = i;
      await createRunningStepSafe({
        executionId,
        stepNumber: i,
        stepType,
        description,
        inputData,
        startedAt: stepStartTime,
      });

      const { observation, scrapedUrl, scrapedTitle, scrapedContent, scrapedScreenshot, scrapedPages, searchResults } =
        await executeStepObservation(action, query || goal || "", currentUrl);

      if (searchResults && searchResults.length > 0) {
        frontier.addCandidates(searchResults, action.query || query || goal || "", i);
        for (const sr of searchResults) {
          if (!evidenceMap.has(sr.url)) {
            evidenceMap.set(sr.url, {
              url: sr.url,
              title: sr.title,
              content: sr.description || sr.markdown || sr.title,
            });
          }
        }
      }

      if (scrapedPages && scrapedPages.length > 0) {
        for (const page of scrapedPages) {
          if (page.url) {
            frontier.recordScraped(page.url, i);
            const dom = extractRootDomain(page.url);
            if (dom) visitedDomains.add(dom);
            if (page.content && page.content.trim().length > 0) {
              evidenceMap.set(page.url, {
                url: page.url,
                title: page.title,
                content: page.content,
              });
            }
          }
        }
      } else if (scrapedUrl) {
        frontier.recordScraped(scrapedUrl, i);
        const dom = extractRootDomain(scrapedUrl);
        if (dom) visitedDomains.add(dom);
        if (scrapedContent) {
          evidenceMap.set(scrapedUrl, {
            url: scrapedUrl,
            title: scrapedTitle,
            content: scrapedContent,
          });
        }
      }

      const evaluation = await evaluateExplorerStep({
        goal: goal || query,
        action,
        observations: observation,
        stepNumber: i,
        maxSteps,
        visitedDomainsCount: visitedDomains.size,
      });

      const stepTokens = (action.tokensUsed || 0) + (evaluation.tokensUsed || 0);

      const stepOutputData: Record<string, unknown> = {
        evaluation,
        observations: observation,
        tokensUsed: stepTokens,
      };

      if (action.type === "search") {
        const q = action.query || goal || query;
        stepOutputData.query = q;
        stepOutputData.results = searchResults || [];
        stepOutputData.searchResults = searchResults || [];
        stepOutputData.count = (searchResults || []).length;
      } else if (action.type === "navigate") {
        stepOutputData.url = scrapedUrl || action.url || currentUrl;
        stepOutputData.urls = navigateTargets;
        stepOutputData.title = scrapedTitle;
        stepOutputData.content = scrapedContent;
        stepOutputData.markdown = scrapedContent;
        stepOutputData.screenshot = scrapedScreenshot;
        stepOutputData.scrapedPages = scrapedPages || [];
        stepOutputData.sources = (scrapedPages || []).map((p) => ({
          url: p.url,
          title: p.title,
          content: p.content,
        }));
      } else if (action.type === "extract") {
        stepOutputData.extractedContent = action.extractedContent;
      } else if (action.type === "finish") {
        stepOutputData.response = action.reasoning;
        stepOutputData.answer = action.reasoning;
      }

      const step: TrajectoryStep = {
        stepNumber: i,
        timestamp: stepStartTime,
        action,
        evaluation,
        observations: observation,
        tokensUsed: stepTokens,
        searchResults: searchResults && searchResults.length > 0 ? (searchResults as any) : undefined,
        outputData: stepOutputData,
      };

      steps.push(step);
      await saveTrajectoryStepSafe(executionId, step);

      await completeTrajectoryStepSafe({
        executionId,
        stepNumber: i,
        stepType,
        description,
        outputData: stepOutputData,
        status: "completed",
      });
      currentRunningStepNumber = null;

      const hasTriangulated = visitedDomains.size >= 2;
      if (action.type === "finish") {
        isFinished = true;
      } else if (evaluation.goalSatisfied && (hasTriangulated || i >= 7)) {
        isFinished = true;
      }
    }
  } catch (err) {
    server.log.error({ err, executionId, scoutId }, "Scout trajectory execution failed");
    executionError = err as Error;
    if (currentRunningStepNumber !== null) {
      await completeTrajectoryStepSafe({
        executionId,
        stepNumber: currentRunningStepNumber,
        outputData: { error: (err as Error).message },
        status: "failed",
        errorMessage: (err as Error).message,
      });
    }
  }

  if (executionError) {
    const durationMs = Date.now() - startTime;
    const totalStepTokens = steps.reduce((acc, s) => acc + (s.tokensUsed || 0), 0);
    const safeError = executionError.message.replace(/([a-zA-Z0-9_\-]{20,})/g, "[REDACTED]");

    await updateExecutionSafe(executionId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: safeError,
      summaryText: null,
      resultsSummary: {
        error: safeError,
        response: `Execution error: ${safeError}`,
        message: safeError,
        taskCompleted: false,
        taskStatus: "failed",
        stepCount: steps.length,
        durationMs,
        totalTokens: totalStepTokens,
      },
    });

    if (scoutId) {
      const baseMinutes = frequencyToMinutes(scoutFrequency);
      const scentMetric = calculateAdaptiveScentInterval({
        scoutId,
        baseIntervalMinutes: baseMinutes,
        driftScore: 0,
        volatilityFactor: 1.0,
        consecutiveFailures: 1,
        now: new Date(),
      });
      await saveScentMetricSafe(scentMetric);
      await updateScoutScheduleSafe(scoutId, {
        lastRunAt: new Date().toISOString(),
        consecutiveFailures: 1,
      });
    }

    return {
      executionId,
      scoutId,
      query,
      status: "failed",
      success: false,
      error: safeError,
      steps,
      stepCount: steps.length,
      durationMs,
      totalTokens: totalStepTokens,
      citations: [],
      httpStatus: 500,
    };
  }

  const evidenceList = Array.from(evidenceMap.values());

  // Inject trajectory extracted facts and explorer conclusions into synthesis evidence
  const trajectoryExtractedFacts = steps
    .map((s) => {
      const extracted =
        s.action.extractedContent ||
        ((s.outputData as Record<string, unknown> | undefined)?.extractedContent as string | undefined);
      const reasoning = s.action.reasoning;
      const parts: string[] = [];
      if (extracted) {
        parts.push(`[Step ${s.stepNumber} (${s.action.type}) Extracted Content]: ${extracted}`);
      }
      if (s.action.type === "finish" && reasoning) {
        parts.push(`[Explorer Final Conclusion]: ${reasoning}`);
      }
      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  if (trajectoryExtractedFacts && trajectoryExtractedFacts.trim().length > 0) {
    const primaryRefUrl =
      evidenceList[0]?.url ||
      (scoutId ? `urn:forager:scout:${scoutId}` : "urn:forager:trajectory:extracted-evidence");
    evidenceList.unshift({
      url: primaryRefUrl,
      title: "Explorer Trajectory Extracted Facts & Concluded Findings",
      content: trajectoryExtractedFacts,
    });
  }

  const effectiveScoutId = scoutId || "00000000-0000-0000-0000-000000000000";
  const { propositions: historicalPropositions, source: sourceFromHist, warning: histWarn } =
    await getHistoricalPropositions(effectiveScoutId);

  const intent = classifyScoutIntent({
    query,
    goal,
    title,
    historicalCount: historicalPropositions.length,
  });

  const isBaseline = intent.isBaseline;

  const synthesis = await synthesizeFinalAnswer({
    query,
    evidence: evidenceList,
    diffContext: {
      isBaseline,
      historicalPropositions,
      missionMode: intent.missionMode,
    },
  });

  const llmFailureReason = steps
    .map((s) => {
      const actionMatch = s.action.reasoning?.match(/LLM invocation failed:\s*(.+)/);
      if (actionMatch) return actionMatch[1];
      const criticMatch = s.evaluation?.feedback?.match(/LLM critic invocation failed:\s*(.+)/);
      if (criticMatch) return criticMatch[1];
      return null;
    })
    .find((r): r is string => Boolean(r));

  const isFailed =
    Boolean(llmFailureReason) ||
    synthesis.answer.includes("Unable to synthesize answer due to API error") ||
    Boolean(synthesis.missingInformation?.includes("Synthesis invocation error"));

  const hasFinishStep = steps.some((s) => s.action.type === "finish");
  if (!hasFinishStep && !isFailed) {
    if (steps.length < maxSteps) {
      const finishStepNumber = steps.length + 1;
      const finishDescription = isFinished
        ? "Target research goal satisfied with grounded multi-source evidence."
        : `Exploration concluded after reaching step limit (${maxSteps} steps). Synthesized findings.`;

      const finishOutputData: Record<string, unknown> = {
        response: synthesis.answer,
        answer: synthesis.answer,
        citations: synthesis.citations,
        isComplete: synthesis.isComplete,
        evidenceSourcesCount: evidenceList.length,
        criticScore: 1.0,
        evaluation: {
          score: 1.0,
          relevance: "high",
          feedback: "Synthesized evidence directly answers target goal.",
          goalSatisfied: true,
          suggestedNextSteps: [],
        },
      };

      await createRunningStepSafe({
        executionId,
        stepNumber: finishStepNumber,
        stepType: "finish",
        description: finishDescription,
        inputData: { query, evidenceSourcesCount: evidenceList.length },
        startedAt: new Date().toISOString(),
      });

      await completeTrajectoryStepSafe({
        executionId,
        stepNumber: finishStepNumber,
        stepType: "finish",
        description: finishDescription,
        outputData: finishOutputData,
        status: "completed",
      });

      const finishStep: TrajectoryStep = {
        stepNumber: finishStepNumber,
        timestamp: new Date().toISOString(),
        action: {
          type: "finish",
          reasoning: finishDescription,
        },
        evaluation: {
          score: 1.0,
          relevance: "high",
          feedback: "Synthesized evidence directly answers target goal.",
          goalSatisfied: true,
          suggestedNextSteps: [],
        },
        observations: synthesis.answer,
        tokensUsed: synthesis.tokensUsed || 0,
        outputData: finishOutputData,
      };

      steps.push(finishStep);
      await saveTrajectoryStepSafe(executionId, finishStep);
    } else if (steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      if (lastStep) {
        lastStep.outputData = {
          ...(lastStep.outputData || {}),
          response: synthesis.answer,
          answer: synthesis.answer,
          citations: synthesis.citations,
        };
        await updateStepOutputDataSafe(executionId, lastStep.stepNumber, {
          response: synthesis.answer,
          answer: synthesis.answer,
          citations: synthesis.citations,
        });
      }
    }
  } else if (steps.length > 0) {
    const finishStep = steps.find((s) => s.action.type === "finish");
    if (finishStep && !isFailed) {
      finishStep.outputData = {
        ...(finishStep.outputData || {}),
        response: synthesis.answer,
        answer: synthesis.answer,
        citations: synthesis.citations,
        isComplete: synthesis.isComplete,
      };
      finishStep.observations = synthesis.answer;
      await updateStepOutputDataSafe(executionId, finishStep.stepNumber, {
        response: synthesis.answer,
        answer: synthesis.answer,
        citations: synthesis.citations,
        isComplete: synthesis.isComplete,
      });
      await saveTrajectoryStepSafe(executionId, finishStep);
    }
  }

  const durationMs = Date.now() - startTime;
  const evidenceUrls = evidenceList.map((e) => e.url);
  const totalStepTokens = steps.reduce((acc, s) => acc + (s.tokensUsed || 0), 0);
  const totalTokens = totalStepTokens + (synthesis.tokensUsed || 0);

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
  const estimatedCostUsd = estimateTokenCost(totalTokens, provider, undefined, undefined, modelName);

  const success = !isFailed && synthesis.isComplete && synthesis.citations.length > 0;
  const executionStatus: "completed" | "incomplete" | "failed" = isFailed
    ? "failed"
    : success
    ? "completed"
    : "incomplete";

  const safeError = isFailed
    ? (llmFailureReason || synthesis.missingInformation || "Provider invocation failed").replace(
        /([a-zA-Z0-9_\-]{20,})/g,
        "[REDACTED]"
      )
    : undefined;

  let driftScore = 0;
  let novelCount = 0;
  let redundantCount = 0;
  let contradictionCount = 0;
  let persistedCount = 0;
  let extractedCount = 0;
  let extractedPropositions: Proposition[] = [];
  let histSource: "database" | "in_memory_fallback" | undefined = undefined;
  let propWarning: string | undefined = undefined;

  let diffSummary = {
    isBaseline,
    novelCount: 0,
    updatedCount: 0,
    redundantCount: 0,
    driftScore: 0,
    novelItems: [] as string[],
    updatedItems: [] as string[],
    redundantItems: [] as string[],
  };

  try {
    const primarySourceUrl = evidenceUrls[0] || (scoutId ? `urn:forager:scout:${scoutId}` : "urn:forager:research");
    extractedPropositions = extractAtomicPropositionsFromText(
      synthesis.answer,
      primarySourceUrl,
      effectiveScoutId,
      executionId
    );
    extractedCount = extractedPropositions.length;

    const embedResult = await attachPropositionEmbeddings(extractedPropositions);
    server.log.info(
      { count: embedResult.count, failed: embedResult.failed, executionId },
      "Attached embeddings to extracted propositions"
    );

    histSource = sourceFromHist;

    const diffResult = await computePropositionDiff(
      extractedPropositions,
      historicalPropositions
    );
    driftScore = diffResult.driftScore;
    novelCount = diffResult.novelCount;
    redundantCount = diffResult.redundantCount;
    contradictionCount = diffResult.contradictionCount;

    diffSummary = {
      isBaseline,
      novelCount,
      updatedCount: contradictionCount,
      redundantCount,
      driftScore,
      novelItems: diffResult.items
        .filter((item) => item.diffType === "novel")
        .map((item) => item.proposition.content),
      updatedItems: diffResult.items
        .filter((item) => item.diffType === "contradiction" || (item.diffType as string) === "updated")
        .map((item) => item.proposition.content),
      redundantItems: diffResult.items
        .filter((item) => item.diffType === "redundant")
        .map((item) => item.proposition.content),
    };

    const toPersistIds = new Set(
      diffResult.items
        .filter((item) => item.diffType === "novel" || item.diffType === "contradiction" || (item.diffType as string) === "updated")
        .map((item) => item.proposition.id)
    );
    const propositionsToPersist = extractedPropositions.filter((p) => toPersistIds.has(p.id));

    for (const item of diffResult.items) {
      if ((item.diffType === "contradiction" || (item.diffType as string) === "updated") && item.nearestPropositionId) {
        await updatePropositionStatusSafe(item.nearestPropositionId, "contradicted");
      }
    }

    const persistResult = await savePropositionsSafe(effectiveScoutId, propositionsToPersist);
    persistedCount = persistResult.persistedCount;
    propWarning = histWarn || persistResult.warning;
  } catch (propErr) {
    server.log.warn({ propErr, executionId }, "Proposition processing failed; continuing with execution completion");
  }

  let veracityAudits: VeracityAudit[] = [];
  try {
    if (!isFailed && evidenceList.length > 0 && extractedPropositions.length > 0) {
      const candidateEvidence = evidenceList.map((e) => ({
        url: e.url,
        domContent: e.content,
      }));

      const claimsToAudit = extractedPropositions.slice(0, 8);
      for (const prop of claimsToAudit) {
        const audit = await auditClaimVeracity(prop.content, candidateEvidence, 2);
        veracityAudits.push(audit);
      }

      if (veracityAudits.length > 0) {
        await saveVeracityAuditsSafe(scoutId, executionId, veracityAudits);
      }
    }
  } catch (auditErr) {
    server.log.warn({ auditErr, executionId }, "Veracity auditing failed; continuing with execution completion");
  }

  const finalStatus: "completed" | "failed" = executionStatus === "completed" ? "completed" : "failed";

  let computedScentMetric: any = null;
  if (scoutId) {
    const baseMinutes = frequencyToMinutes(scoutFrequency);
    const consecutiveFailures = isFailed ? 1 : 0;
    const schedState = scentScheduler.getScoutState(scoutId);
    let currentStagnantCycles = schedState ? schedState.stagnantCycles : 0;

    if (isFailed) {
      currentStagnantCycles = 0;
    } else if (executionStatus === "completed") {
      if (driftScore === 0) {
        currentStagnantCycles += 1;
      } else {
        currentStagnantCycles = 0;
      }
    }

    computedScentMetric = calculateAdaptiveScentInterval({
      scoutId,
      baseIntervalMinutes: baseMinutes,
      driftScore: isFailed ? 0 : driftScore,
      volatilityFactor: 1.0,
      consecutiveFailures,
      stagnantCycles: currentStagnantCycles,
      now: new Date(),
    });

    await saveScentMetricSafe(computedScentMetric);
    await updateScoutScheduleSafe(scoutId, {
      lastRunAt: new Date().toISOString(),
      consecutiveFailures,
    });

    if (schedState) {
      schedState.lastRunAt = new Date();
      schedState.consecutiveFailures = consecutiveFailures;
      schedState.stagnantCycles = currentStagnantCycles;
      schedState.computedIntervalMinutes = computedScentMetric.computedIntervalMinutes;
      schedState.nextRunAt = new Date(computedScentMetric.nextRunAt);
    }
  }

  await updateExecutionSafe(executionId, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    errorMessage: isFailed
      ? safeError
      : success
      ? null
      : (synthesis.missingInformation || "Insufficient evidence to answer query"),
    summaryText: isFailed ? null : synthesis.answer,
    resultsSummary: {
      response: isFailed ? (safeError || "Execution failed") : synthesis.answer,
      message: isFailed ? (safeError || "Execution failed") : synthesis.answer,
      summary: synthesis.answer,
      taskCompleted: success,
      taskStatus: finalStatus,
      citations: isFailed ? [] : synthesis.citations,
      tokenUsage: { totalTokens, totalStepTokens, synthesisTokens: synthesis.tokensUsed },
      estimatedCostUsd,
      isComplete: synthesis.isComplete,
      success,
      status: executionStatus,
      durationMs,
      evidenceUrls,
      error: safeError || null,
      novelCount,
      updatedCount: contradictionCount,
      redundantCount,
      driftScore,
      diffSummary,
      audits: veracityAudits.map((a) => ({
        id: crypto.randomUUID(),
        scoutId,
        executionId,
        claim: a.claim,
        overallConfidence: a.overallConfidence,
        independentSourcesCount: a.independentSourcesCount,
        citations: a.citations,
        hasContradiction: a.hasContradiction,
        contradictionDetails: a.contradictionDetails,
        auditPassed: a.auditPassed,
        createdAt: new Date().toISOString(),
      })),
      veracityPassRate:
        veracityAudits.length > 0
          ? veracityAudits.filter((a) => a.auditPassed).length / veracityAudits.length
          : null,
      scent: computedScentMetric
        ? {
            id: computedScentMetric.id || crypto.randomUUID(),
            scoutId: computedScentMetric.scoutId,
            driftScore: computedScentMetric.driftScore,
            volatilityFactor: computedScentMetric.volatilityFactor,
            baseIntervalMinutes: computedScentMetric.baseIntervalMinutes,
            computedIntervalMinutes: computedScentMetric.computedIntervalMinutes,
            nextRunAt: computedScentMetric.nextRunAt,
            recordedAt: computedScentMetric.recordedAt || new Date().toISOString(),
          }
        : undefined,
      propositions: {
        extractedCount,
        novelCount,
        updatedCount: contradictionCount,
        redundantCount,
        persistedCount,
        diffSummary,
        items: extractedPropositions.map((p) => ({
          id: p.id,
          scoutId: p.scoutId,
          executionId: p.executionId,
          content: p.content,
          sourceUrl: p.sourceUrl,
          confidence: p.confidence,
          status: p.status,
          createdAt: p.createdAt,
        })),
      },
    },
  });

  if (scoutId && !isFailed) {
    try {
      let scoutNotifyEmail: string | undefined;
      let notifyOnGoalMatch = true;
      let notifyOnDrift = true;

      try {
        const client = getServiceClient();
        const { data: scoutRecord } = await client
          .from("scouts")
          .select("location, user_id")
          .eq("id", scoutId)
          .single();

        if (scoutRecord?.location && typeof scoutRecord.location === "object") {
          const loc = scoutRecord.location as Record<string, unknown>;
          if (loc.notifyEmail) scoutNotifyEmail = String(loc.notifyEmail);
          if (typeof loc.notifyOnGoalMatch === "boolean") notifyOnGoalMatch = loc.notifyOnGoalMatch;
          if (typeof loc.notifyOnDrift === "boolean") notifyOnDrift = loc.notifyOnDrift;
        }

        if (!scoutNotifyEmail && scoutRecord?.user_id) {
          const { data: userData } = await client.auth.admin.getUserById(scoutRecord.user_id);
          scoutNotifyEmail =
            (userData?.user?.user_metadata?.notification_email as string) || userData?.user?.email;
        }
      } catch {}

      if (!isBaseline && (novelCount > 0 || contradictionCount > 0) && notifyOnDrift) {
        let urgency: "low" | "medium" | "high" = "medium";
        let notifTitle = `[${title || query}] Novel Findings Detected`;
        let notifMsg = `Found ${novelCount} new item(s) and ${contradictionCount} updated claim(s).`;

        if (intent.missionMode === "metric_delta") {
          urgency = "high";
          notifTitle = `[${title || query}] Metric Alert: Value Shift Detected`;
          notifMsg = `Detected ${contradictionCount} metric/price update(s) and ${novelCount} new proposition(s).`;
        } else if (novelCount > 0) {
          notifTitle = `[${title || query}] +${novelCount} New Discoveries`;
          notifMsg = `Discovered ${novelCount} new proposition(s) not present in previous baseline.`;
        }

        await sendNotification({
          scoutId,
          executionId,
          title: notifTitle,
          message: notifMsg,
          urgency,
          recipientEmail: scoutNotifyEmail,
        });
      } else if (isBaseline && extractedCount > 0 && notifyOnGoalMatch) {
        await sendNotification({
          scoutId,
          executionId,
          title: `[${title || query}] Baseline Established`,
          message: `Initial run recorded ${extractedCount} baseline propositions.`,
          urgency: "low",
          recipientEmail: scoutNotifyEmail,
        });
      } else if (success && notifyOnGoalMatch) {
        await sendNotification({
          scoutId,
          executionId,
          title: `[${title || query}] Research Goal Satisfied`,
          message: `Autonomous research completed and verified across ${evidenceUrls.length} source(s) with ${redundantCount} corroborated claim(s).`,
          urgency: "low",
          recipientEmail: scoutNotifyEmail,
        });
      }
    } catch (notifErr) {
      server.log.warn({ notifErr, executionId, scoutId }, "Autonomous notification trigger failed; continuing");
    }
  }

  return {
    executionId,
    scoutId,
    query,
    answer: synthesis.answer,
    citations: isFailed ? [] : synthesis.citations,
    isComplete: synthesis.isComplete,
    success,
    status: executionStatus,
    missingInformation: synthesis.missingInformation,
    error: safeError,
    steps,
    stepCount: steps.length,
    durationMs,
    totalTokens,
    estimatedCostUsd,
    evidenceUrls,
    propositions: {
      extractedCount,
      novelCount,
      redundantCount,
      contradictionCount,
      persistedCount,
      historicalSource: histSource,
      warning: propWarning,
    },
    driftScore,
    diffSummary,
    httpStatus: 200,
  };
}

