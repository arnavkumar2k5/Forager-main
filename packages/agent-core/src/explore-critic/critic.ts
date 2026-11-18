import { CriticEvaluation, CriticEvaluationSchema, ExplorerAction, FrontierCandidate } from "@repo/types";
import { CRITIC_SYSTEM_PROMPT } from "../prompts";
import { invokeLLM } from "../llm/client";
import { extractQueryKeywords } from "../extraction/passages";
import { detectBotChallenge } from "./anti-bot";

export interface CriticEvaluationParams {
  goal: string;
  action: ExplorerAction;
  observations: string;
  stepNumber: number;
  maxSteps?: number;
  visitedDomainsCount?: number;
}

export type CriticEvaluationResult = CriticEvaluation & {
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
};

export function buildCriticPrompt(params: CriticEvaluationParams): string {
  const { goal, action, observations, stepNumber, maxSteps = 10, visitedDomainsCount = 0 } = params;
  const currentDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `
Temporal Anchor: Current Date is ${currentDate}.
Target Research Goal: "${goal}"
Step ${stepNumber} of maximum ${maxSteps} (Unique root domains visited so far: ${visitedDomainsCount})

Explorer Action Evaluated:
- Type: ${action.type}
- Reasoning: ${action.reasoning}
${action.url ? `- Target URL: ${action.url}` : ""}
${action.query ? `- Search Query: ${action.query}` : ""}
${action.extractedContent ? `- Extracted Content: ${action.extractedContent}` : ""}

Current Observation / Evidence:
${observations ? observations.slice(0, 5000) : "No observation recorded."}

Instructions:
1. Objectively evaluate whether this step produces credible, relevant evidence toward answering the target goal.
2. Temporal Directive:
   - If the goal explicitly requests upcoming/future schedules, verify whether observed evidence describes events occurring on or after ${currentDate}.
   - If the goal specifies a past year, historical edition, or established fact (e.g. 2024, 2022, 2002), verify evidence against the target timeframe requested rather than forcing future dates.
3. Formulate:
   - "score": numeric value from 0.0 to 1.0 reflecting relevance and factual quality.
   - "relevance": "low" (< 0.4), "medium" (0.4 - 0.7), or "high" (> 0.7).
   - "feedback": concise qualitative assessment of evidence quality and goal alignment.
   - "goalSatisfied": boolean indicating whether conclusive evidence now directly answers the research goal. Set to true if the observations contain direct, grounded factual answers to the goal (such as specific dates, metrics, names, or key attributes requested).
   - "suggestedNextSteps": array of 1-3 concrete next recommendations (e.g. navigate to a discovered link, reformulate query, extract claims).
4. Output strictly valid JSON conforming to this schema:
{
  "score": number,
  "relevance": "low" | "medium" | "high",
  "feedback": "string",
  "goalSatisfied": boolean,
  "suggestedNextSteps": ["string"]
}
`.trim();
}

function parseJsonFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1]!.trim() : trimmed;
  return JSON.parse(jsonStr);
}

function fallbackHeuristicEvaluation(
  params: CriticEvaluationParams,
  reasoningNote: string,
  tokensUsed = 0
): CriticEvaluationResult {
  const { goal, action, observations, stepNumber } = params;

  const botCheck = detectBotChallenge({ content: observations });
  if (botCheck.isBlocked) {
    return {
      score: 0.1,
      relevance: "low",
      feedback: `Step ${stepNumber} (${action.type}) hit anti-bot challenge (${botCheck.reason}). Direct page inspection blocked. (${reasoningNote})`,
      goalSatisfied: false,
      suggestedNextSteps: [
        "Domain blocked by anti-bot challenge. Do not retry this domain.",
        "Pivot to search for secondary corroborating sources, aggregators, or pricing portals.",
      ],
      tokensUsed,
    };
  }

  const goalWords = goal.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const obsLower = observations.toLowerCase();
  const matchedWords = goalWords.filter((w) => obsLower.includes(w));
  const matchRatio = goalWords.length > 0 ? matchedWords.length / goalWords.length : 0;

  let score = Math.min(1.0, Math.max(0.1, Number((0.2 + matchRatio * 0.8).toFixed(2))));

  const canSatisfyGoal = action.type === "navigate" || action.type === "extract" || action.type === "finish";

  if (action.type === "search") {
    score = Math.min(0.6, score);
  }

  const goalSatisfied = canSatisfyGoal && (matchRatio >= 0.65 || action.type === "finish");

  const relevance: "low" | "medium" | "high" =
    score > 0.7 ? "high" : score > 0.4 ? "medium" : "low";

  const suggestedNextSteps: string[] = [];
  if (!goalSatisfied) {
    if (action.type === "search") {
      suggestedNextSteps.push("Navigate to top candidate URL from search results to inspect page DOM.");
    } else if (matchRatio < 0.3) {
      suggestedNextSteps.push("Prune current branch; query domain appears out of scope.");
      suggestedNextSteps.push("Formulate alternative query focusing on missing keywords.");
    } else {
      suggestedNextSteps.push("Isolate extracted atomic propositions and verify leaf citations.");
    }
  }

  return {
    score,
    relevance,
    feedback: `Evaluated step ${stepNumber} (${action.type}). Matched ${matchedWords.length}/${goalWords.length} key goal terms. Relevance: ${relevance}. (${reasoningNote})`,
    goalSatisfied,
    suggestedNextSteps,
    tokensUsed,
  };
}

export async function evaluateExplorerStep(
  params: CriticEvaluationParams
): Promise<CriticEvaluationResult> {
  const { action } = params;

  try {
    const prompt = buildCriticPrompt(params);
    const llmResponse = await invokeLLM([
      { role: "system", content: CRITIC_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    let parsed: unknown;
    try {
      parsed = parseJsonFromText(llmResponse.content);
    } catch {
      return fallbackHeuristicEvaluation(
        params,
        "Model output was not valid JSON; fallback applied",
        llmResponse.tokensUsed
      );
    }

    const validated = CriticEvaluationSchema.safeParse(parsed);
    if (!validated.success) {
      return fallbackHeuristicEvaluation(
        params,
        "Model output failed Zod schema validation; fallback applied",
        llmResponse.tokensUsed
      );
    }

    const evaluation = validated.data;

    const botCheck = detectBotChallenge({ content: params.observations });
    if (botCheck.isBlocked) {
      evaluation.score = Math.min(0.2, evaluation.score);
      evaluation.relevance = "low";
      evaluation.goalSatisfied = false;
      evaluation.feedback = `${evaluation.feedback} [Anti-bot challenge or blocked page detected (${botCheck.reason}). Direct page inspection blocked.]`;
      evaluation.suggestedNextSteps = [
        "Domain blocked by anti-bot challenge. Do not retry this domain.",
        "Pivot to search for secondary corroborating sources, aggregators, or pricing portals.",
      ];
    }

    // Invariant 1: Search alone cannot satisfy research goal
    if (action.type === "search") {
      evaluation.goalSatisfied = false;
      evaluation.score = Math.min(0.6, evaluation.score);
    }

    // Invariant 2: Low score (< 0.6) or low relevance cannot claim goal is satisfied
    if (evaluation.score < 0.6 || evaluation.relevance === "low") {
      evaluation.goalSatisfied = false;
    }

    // Invariant 3: Explicit missing or incomplete signals in feedback override goalSatisfied to false
    const incompleteSignals = [
      "incomplete",
      "not contain",
      "does not contain",
      "missing",
      "not yet",
      "unanswered",
      "insufficient",
      "has not been retrieved",
      "not found",
      "lacks",
      "does not mention",
      "not provided",
    ];
    const feedbackLower = evaluation.feedback.toLowerCase();
    if (incompleteSignals.some((sig) => feedbackLower.includes(sig))) {
      evaluation.goalSatisfied = false;
    }

    // Invariant 4: Research Invariant - Multi-source triangulation when tracking wide domains
    if (
      params.visitedDomainsCount !== undefined &&
      params.visitedDomainsCount < 2 &&
      params.stepNumber < (params.maxSteps ?? 10)
    ) {
      evaluation.goalSatisfied = false;
    }

    return {
      ...evaluation,
      tokensUsed: llmResponse.tokensUsed,
      promptTokens: llmResponse.promptTokens,
      completionTokens: llmResponse.completionTokens,
    };
  } catch (err) {
    return fallbackHeuristicEvaluation(
      params,
      `LLM critic invocation failed: ${(err as Error).message}`
    );
  }
}

export interface FrontierPruningParams {
  goal: string;
  candidates: FrontierCandidate[];
  exploredDomains?: string[];
  maxSelect?: number;
}

export interface FrontierPruningResult {
  selectedUrls: string[];
  prunedUrls: string[];
  scoredCandidates: Array<{
    url: string;
    rootDomain: string;
    score: number;
    relevance: "low" | "medium" | "high";
    action: "select" | "queue" | "prune";
  }>;
}

export function pruneAndRankFrontierCandidates(
  params: FrontierPruningParams
): FrontierPruningResult {
  const { goal, candidates, exploredDomains = [], maxSelect = 3 } = params;
  if (!candidates || candidates.length === 0) {
    return { selectedUrls: [], prunedUrls: [], scoredCandidates: [] };
  }

  const { terms, phrases } = extractQueryKeywords(goal);
  const termsLower = terms.map((t) => t.toLowerCase());
  const phrasesLower = phrases.map((p) => p.toLowerCase());
  const exploredSet = new Set(exploredDomains.map((d) => d.toLowerCase()));

  interface ScoredCandidate {
    url: string;
    canonicalUrl: string;
    rootDomain: string;
    score: number;
    relevance: "low" | "medium" | "high";
    action: "select" | "queue" | "prune";
    isDomainExplored: boolean;
  }

  const scored: ScoredCandidate[] = candidates.map((cand): ScoredCandidate => {
    const textBlob = `${cand.title} ${cand.snippet} ${cand.url}`.toLowerCase();

    let matchedCount = 0;
    for (const term of termsLower) {
      if (textBlob.includes(term)) matchedCount++;
    }
    let phraseBonus = 0;
    for (const phrase of phrasesLower) {
      if (textBlob.includes(phrase)) phraseBonus += 0.2;
    }

    const termScore = termsLower.length > 0 ? (matchedCount / termsLower.length) * 0.7 : 0.4;
    let score = Math.min(1.0, Math.max(0.1, Number((termScore + phraseBonus).toFixed(2))));

    // Agentic domain exploration: give slight novelty bonus to unvisited domains for N >= 2 corroboration
    const isDomainExplored = exploredSet.has(cand.rootDomain.toLowerCase());
    if (!isDomainExplored) {
      score = Math.min(1.0, Number((score + 0.15).toFixed(2)));
    }

    const isSpamOrBoilerplate = /\b(login|signin|privacy-policy|terms-of-service|cookie-policy|subscribe)\b/i.test(
      cand.url
    );

    let action: "select" | "queue" | "prune" = "queue";
    if (isSpamOrBoilerplate || score < 0.25) {
      action = "prune";
    }

    const relevance: "low" | "medium" | "high" =
      score > 0.65 ? "high" : score > 0.4 ? "medium" : "low";

    const candidateAction: "select" | "queue" | "prune" = action;

    return {
      url: cand.url,
      canonicalUrl: cand.canonicalUrl,
      rootDomain: cand.rootDomain,
      score,
      relevance,
      action: candidateAction,
      isDomainExplored,
    };
  });

  const prunedUrls = scored.filter((s) => s.action === "prune").map((s) => s.url);
  const viable = scored.filter((s) => s.action !== "prune");

  // Sort by score descending
  viable.sort((a, b) => b.score - a.score);

  // Select top candidates maximizing domain diversity first, then deep paths
  const selectedUrls: string[] = [];
  const chosenDomains = new Set<string>();

  for (const item of viable) {
    if (!chosenDomains.has(item.rootDomain)) {
      selectedUrls.push(item.url);
      chosenDomains.add(item.rootDomain);
      item.action = "select";
      if (selectedUrls.length >= maxSelect) break;
    }
  }

  if (selectedUrls.length < maxSelect) {
    for (const item of viable) {
      if (!selectedUrls.includes(item.url)) {
        selectedUrls.push(item.url);
        item.action = "select";
        if (selectedUrls.length >= maxSelect) break;
      }
    }
  }

  return {
    selectedUrls,
    prunedUrls,
    scoredCandidates: scored.map((s) => ({
      url: s.url,
      rootDomain: s.rootDomain,
      score: s.score,
      relevance: s.relevance,
      action: s.action,
    })),
  };
}
