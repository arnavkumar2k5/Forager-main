import { ExplorerAction, ExplorerActionSchema, FrontierCandidate, TrajectoryStep } from "@repo/types";
import { EXPLORER_SYSTEM_PROMPT } from "../prompts";
import { invokeLLM } from "../llm/client";
import { extractQueryKeywords } from "../extraction/passages";
import { pruneAndRankFrontierCandidates } from "./critic";
import { detectBotChallenge } from "./anti-bot";
import { extractRootDomain } from "./frontier";

export interface ExplorerStepParams {
  goal: string;
  title?: string;
  suggestedQueries?: string[];
  trajectoryHistory: TrajectoryStep[];
  currentObservation?: string;
  currentUrl?: string;
  maxSteps?: number;
  stepNumber?: number;
  frontierCandidates?: FrontierCandidate[];
  exploredDomains?: string[];
  blockedDomains?: string[];
}

export type ExplorerStepResult = ExplorerAction & {
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
};

export function extractBlockedDomainsFromHistory(
  trajectoryHistory: TrajectoryStep[],
  currentObservation?: string,
  currentUrl?: string
): string[] {
  const blocked = new Set<string>();
  for (const step of trajectoryHistory) {
    if (step.observations && detectBotChallenge({ content: step.observations }).isBlocked) {
      const url = step.action.url || (step.action.urls && step.action.urls[0]);
      const dom = extractRootDomain(url);
      if (dom && dom !== "unknown") blocked.add(dom);
    }
    if (step.evaluation?.suggestedNextSteps?.some((s) => s.toLowerCase().includes("anti-bot"))) {
      const url = step.action.url || (step.action.urls && step.action.urls[0]);
      const dom = extractRootDomain(url);
      if (dom && dom !== "unknown") blocked.add(dom);
    }
  }
  if (currentObservation && detectBotChallenge({ content: currentObservation }).isBlocked && currentUrl) {
    const dom = extractRootDomain(currentUrl);
    if (dom && dom !== "unknown") blocked.add(dom);
  }
  return Array.from(blocked);
}

export function buildExplorerPrompt(params: ExplorerStepParams): string {
  const {
    goal,
    title,
    suggestedQueries,
    trajectoryHistory,
    currentObservation,
    currentUrl,
    stepNumber = params.trajectoryHistory.length + 1,
    maxSteps = 10,
    frontierCandidates,
    exploredDomains,
  } = params;
  const now = new Date();
  const currentDate = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentMonthName = now.toLocaleString("en-US", { month: "long" });

  const isLateYear = currentMonth >= 10;
  const upcomingHorizon = isLateYear
    ? `late ${currentYear} and full year ${currentYear + 1}`
    : `upcoming months of ${currentYear} and ${currentYear + 1}`;
  const targetSearchYear = isLateYear ? currentYear + 1 : currentYear;

  const visitedUrls = Array.from(
    new Set(
      trajectoryHistory
        .flatMap((s) => [s.action.url, ...(s.action.urls || [])])
        .filter((u): u is string => Boolean(u && u.startsWith("http")))
    )
  );

  const historyFormatted = trajectoryHistory
    .map((s) => {
      const criticDetails = s.evaluation
        ? `[Critic Feedback]: score=${s.evaluation.score}, relevance=${s.evaluation.relevance}, feedback="${s.evaluation.feedback}"${
            s.evaluation.suggestedNextSteps.length > 0
              ? `, suggestions: ${s.evaluation.suggestedNextSteps.join("; ")}`
              : ""
          }`
        : "[Critic Feedback]: None";

      const actionDesc =
        s.action.urls && s.action.urls.length > 1
          ? `navigate (batch: ${s.action.urls.join(", ")})`
          : `${s.action.type}${s.action.url ? ` (${s.action.url})` : s.action.query ? ` ("${s.action.query}")` : ""}`;

      return `Turn ${s.stepNumber}: Action: ${actionDesc}
${criticDetails}
Observation Excerpt: ${s.observations ? s.observations.slice(0, 500) : "None"}`;
    })
    .join("\n\n");

  const latestEvaluation =
    trajectoryHistory.length > 0
      ? trajectoryHistory[trajectoryHistory.length - 1]?.evaluation
      : undefined;

  const criticGuidance = latestEvaluation
    ? `Latest Critic Guidance:
- Score: ${latestEvaluation.score} (${latestEvaluation.relevance})
- Assessment: ${latestEvaluation.feedback}
- Suggested Actions: ${latestEvaluation.suggestedNextSteps.join("; ") || "Continue methodical exploration"}`
    : "No prior critic evaluation (Initial step).";

  const suggestionsBlock =
    suggestedQueries && suggestedQueries.length > 0
      ? `Suggested Keyword Queries: ${suggestedQueries.join(", ")}`
      : "";

  const candidatesBlock =
    frontierCandidates && frontierCandidates.length > 0
      ? `Discovered Candidate Frontier (${frontierCandidates.length} unvisited links accumulated across searches):
${frontierCandidates
  .slice(0, 6)
  .map(
    (c, i) =>
      `- [Candidate ${i + 1}] "${c.title}" (${c.url}) [Domain: ${c.rootDomain}]: ${c.snippet.slice(0, 160)}`
  )
  .join("\n")}`
      : "";

  const domainsBlock =
    exploredDomains && exploredDomains.length > 0
      ? `Domains Explored So Far: ${exploredDomains.join(", ")} (Target: >= 2 independent root domains)`
      : "";

  const allBlockedDomains = Array.from(
    new Set([
      ...(params.blockedDomains || []),
      ...extractBlockedDomainsFromHistory(trajectoryHistory, currentObservation, currentUrl),
    ])
  );
  const blockedBlock =
    allBlockedDomains.length > 0
      ? `Blocked / Protected Domains (Do NOT navigate to these): ${allBlockedDomains.join(", ")}`
      : "";

  const queryLower = (goal || "").toLowerCase();
  const isProspectiveEventQuery = /\b(upcoming\s+(event|conference|summit|hackathon|deadline)|dates?\s+for\s+202[6-9]|schedule\s+for\s+202[6-9])\b/i.test(queryLower);
  const isTechOrPricingQuery = /\b(price|pricing|cost|model|models|api|tool|tools|library|benchmark|gpu|tier)\b/i.test(queryLower);

  const temporalInstruction = isProspectiveEventQuery
    ? `- Prospective Event Query Detected: The user asks for upcoming events, conferences, or deadlines. Target the upcoming horizon (${upcomingHorizon}) and verify that extracted event dates occur on or after ${currentDate}. Reject expired dates.`
    : isTechOrPricingQuery
    ? `- Live Tech / Pricing Query Detected: AI models, software packages, and API pricing change frequently (monthly or weekly). Search for current live rates, docs, and benchmarks directly without artificially appending a calendar year unless the user explicitly requested a specific year.`
    : `- Specific Query: Retrieve and preserve current or specified facts as requested by the research goal. Do NOT append unnecessary calendar years to search queries.`;

  return `
Temporal Anchor: Current Date is ${currentDate} (${currentMonthName} ${currentYear}).
Research Mission: "${title || "Automated Web Scout"}"
Research Goal: "${goal}"
Iteration: ${stepNumber} of maximum ${maxSteps}
${suggestionsBlock}
${domainsBlock}
${blockedBlock}
Current URL: ${currentUrl || "None (Initial entry point)"}
Already Visited URLs: ${visitedUrls.length > 0 ? visitedUrls.join(", ") : "None"}

${candidatesBlock}

Trajectory History:
${historyFormatted || "None yet. This is Iteration 1."}

${criticGuidance}

Latest Observation:
${currentObservation ? currentObservation.slice(0, 2000) : "Awaiting initial observation."}

Instructions:
1. Temporal Directive & Query Intelligence:
   - Current Date: ${currentDate} (${currentMonthName} ${currentYear}).
   ${temporalInstruction}
2. Multi-Source Corroboration: Research invariant prioritizes evidence from at least 2 independent root domains when answering open-ended landscape questions. If evaluating a specific entity on its primary home domain, ground citations directly in authoritative pages.
3. Resilient Recovery: If an anti-bot challenge or 403 access denial was detected, NEVER revisit that domain. Immediately pivot to "search" targeting third-party reviews, price aggregators, or secondary databases.
4. Stopping Condition:
   - When the observations contain sufficient, direct, and verifiable evidence that answers the user's research goal, emit "finish" immediately. Do NOT perform unnecessary redundant iterations.
5. Formulate the next optimal trajectory action: "search", "navigate", "extract", or "finish".
   - Use "search" to query the web. Formulate intelligent, concise 2-4 word keyword queries targeting the specific subject matter. NEVER search for the entire conversational goal sentence, and do NOT append an arbitrary calendar year unless the goal explicitly specifies a dated annual edition.
   - Use "navigate" to visit 1 or more promising, unvisited HTTP/HTTPS URLs from the Discovered Candidate Frontier to inspect page content. You can supply a single "url": "https://..." or a batch in "urls": ["https://...", "https://..."] to fetch concurrently.
     * Dynamic Path Selection: You may explore a deeper subpath on an already visited domain if it offers strong information scent, OR branch out to an unvisited domain to corroborate findings.
   - Use "extract" to isolate high-confidence factual claims directly from the current observation.
   - Use "finish" as soon as sufficient grounded evidence has resolved the goal. When finishing, provide structured reasoning organized with bullet points, dates, and domain attributions.
6. Output strictly valid JSON conforming to this format:
{
  "type": "search" | "navigate" | "extract" | "finish",
  "query": "concise 2-4 word keyword query string if type is search",
  "url": "https://... if type is navigate",
  "urls": ["https://...", "https://..."] optional batch URLs for concurrent scrape,
  "reasoning": "structured rationale explaining how this action responds to observations and critic guidance to satisfy the goal",
  "extractedContent": "isolated facts if type is extract"
}
`.trim();
}

function parseJsonFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = jsonMatch ? jsonMatch[1]!.trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      let extracted = candidate.slice(firstBrace, lastBrace + 1);
      extracted = extracted.replace(/\/\/[^\n\r]*/g, "");
      extracted = extracted.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(extracted);
    }
    throw new Error("No parseable JSON object found in LLM response");
  }
}

function getCleanSearchQuery(params: ExplorerStepParams): string {
  const { goal, suggestedQueries, trajectoryHistory } = params;
  const searched = new Set(
    trajectoryHistory
      .map((s) => s.action.query?.toLowerCase().trim())
      .filter((q): q is string => Boolean(q))
  );

  if (suggestedQueries && suggestedQueries.length > 0) {
    const nextUnused = suggestedQueries.find((q) => !searched.has(q.toLowerCase().trim()));
    if (nextUnused) return nextUnused;
  }

  const { terms } = extractQueryKeywords(goal);
  if (terms.length > 0) {
    return terms.slice(0, 4).join(" ");
  }

  return goal;
}

function fallbackHeuristicAction(
  params: ExplorerStepParams,
  reasoningNote: string,
  tokensUsed = 0
): ExplorerStepResult {
  const { goal, trajectoryHistory, currentObservation, currentUrl, frontierCandidates = [], exploredDomains = [] } = params;

  const lastStep = trajectoryHistory[trajectoryHistory.length - 1];

  const allBlockedDomains = Array.from(
    new Set([
      ...(params.blockedDomains || []),
      ...extractBlockedDomainsFromHistory(trajectoryHistory, currentObservation, currentUrl),
    ])
  );

  const isCurrentlyBlocked =
    Boolean(currentObservation && detectBotChallenge({ content: currentObservation }).isBlocked) ||
    Boolean(lastStep?.evaluation?.suggestedNextSteps?.some((s) => s.toLowerCase().includes("anti-bot")));

  if (isCurrentlyBlocked) {
    const cleanQuery = getCleanSearchQuery(params);
    const pivotQuery = `${cleanQuery} review aggregator pricing`;
    return {
      type: "search",
      query: pivotQuery,
      reasoning: `Target website triggered anti-bot protection. Pivoting to search secondary sources and aggregators for "${pivotQuery}". (${reasoningNote})`,
      tokensUsed,
    };
  }

  if (trajectoryHistory.length === 0 && currentUrl && currentUrl.startsWith("http")) {
    const rootDom = extractRootDomain(currentUrl);
    if (!allBlockedDomains.includes(rootDom)) {
      return {
        type: "navigate",
        url: currentUrl,
        urls: [currentUrl],
        reasoning: `Navigating to initial root seed anchor: ${currentUrl} (${reasoningNote})`,
        tokensUsed,
      };
    }
  }

  const visitedUrls = new Set(
    trajectoryHistory
      .flatMap((s) => [s.action.url, ...(s.action.urls || [])])
      .filter((u): u is string => Boolean(u && u.startsWith("http")))
  );

  const seedQuery = getCleanSearchQuery(params);

  if (trajectoryHistory.length === 0) {
    return {
      type: "search",
      query: seedQuery,
      reasoning: `Initiating seed search for: "${seedQuery}" (${reasoningNote})`,
      tokensUsed,
    };
  }

  const unvisitedFrontier = frontierCandidates.filter(
    (c) =>
      !visitedUrls.has(c.url) &&
      !visitedUrls.has(c.canonicalUrl) &&
      !allBlockedDomains.includes(c.rootDomain)
  );

  if (lastStep?.action.type === "search" && currentObservation) {
    const allUrls = Array.from(currentObservation.matchAll(/https?:\/\/[^\s)"]+/g)).map((m) => m[0]);
    const unvisitedUrl = allUrls.find((u) => !visitedUrls.has(u));

    if (unvisitedUrl) {
      return {
        type: "navigate",
        url: unvisitedUrl,
        urls: [unvisitedUrl],
        reasoning: `Discovered promising unvisited seed URL in search results. (${reasoningNote})`,
        tokensUsed,
      };
    }

    return {
      type: "search",
      query: seedQuery,
      reasoning: `Candidate URLs already visited; executing targeted search for "${seedQuery}". (${reasoningNote})`,
      tokensUsed,
    };
  }

  if (lastStep?.action.type === "navigate" && currentObservation) {
    return {
      type: "extract",
      url: currentUrl,
      reasoning: `Extracting candidate factual claims from page observation. (${reasoningNote})`,
      extractedContent: currentObservation.slice(0, 500),
      tokensUsed,
    };
  }

  return {
    type: "finish",
    reasoning: `Safe trajectory conclusion reached. (${reasoningNote})`,
    tokensUsed,
  };
}

export async function executeExplorerStep(params: ExplorerStepParams): Promise<ExplorerStepResult> {
  const { goal, trajectoryHistory, maxSteps = 10 } = params;
  const stepNumber = params.stepNumber ?? trajectoryHistory.length + 1;

  if (stepNumber > maxSteps || trajectoryHistory.length >= maxSteps) {
    return {
      type: "finish",
      reasoning: `Maximum trajectory depth (${maxSteps} steps) reached. Terminating safely.`,
      tokensUsed: 0,
    };
  }

  try {
    const prompt = buildExplorerPrompt(params);
    const llmResponse = await invokeLLM([
      { role: "system", content: EXPLORER_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    let parsed: unknown;
    try {
      parsed = parseJsonFromText(llmResponse.content);
    } catch {
      return fallbackHeuristicAction(
        params,
        "Model output was not valid JSON; fallback applied",
        llmResponse.tokensUsed
      );
    }

    const validated = ExplorerActionSchema.safeParse(parsed);
    if (!validated.success) {
      return fallbackHeuristicAction(
        params,
        "Model output failed Zod schema validation; fallback applied",
        llmResponse.tokensUsed
      );
    }

    const action = validated.data;

    const allBlockedDomains = Array.from(
      new Set([
        ...(params.blockedDomains || []),
        ...extractBlockedDomainsFromHistory(trajectoryHistory, params.currentObservation, params.currentUrl),
      ])
    );

    if (action.type === "navigate") {
      if (action.urls && action.urls.length > 0) {
        action.urls = action.urls
          .filter((u) => u && u.startsWith("http"))
          .filter((u) => !allBlockedDomains.includes(extractRootDomain(u)));
        if (!action.url && action.urls[0]) {
          action.url = action.urls[0];
        }
      }

      const singleDomain = extractRootDomain(action.url);
      if (singleDomain && allBlockedDomains.includes(singleDomain)) {
        action.url = undefined;
      }

      if (!action.url || !action.url.startsWith("http")) {
        const urlMatch = params.currentObservation?.match(/https?:\/\/[^\s)"]+/);
        const candidateUrl = urlMatch ? urlMatch[0] : undefined;
        const candidateDomain = candidateUrl ? extractRootDomain(candidateUrl) : undefined;

        if (candidateUrl && candidateDomain && !allBlockedDomains.includes(candidateDomain)) {
          action.url = candidateUrl;
          action.urls = [candidateUrl];
        } else {
          const cleanQuery = getCleanSearchQuery(params);
          return {
            type: "search",
            query: `${cleanQuery} review aggregator`,
            reasoning: singleDomain && allBlockedDomains.includes(singleDomain)
              ? `Domain ${singleDomain} is protected by anti-bot verification. Pivoting to search secondary sources.`
              : "Navigate action lacked valid unblocked URL; redirected to search.",
            tokensUsed: llmResponse.tokensUsed,
            promptTokens: llmResponse.promptTokens,
            completionTokens: llmResponse.completionTokens,
          };
        }
      }

      if (action.url && (!action.urls || action.urls.length === 0)) {
        action.urls = [action.url];
      }
    }

    if (action.type === "search" && (!action.query || action.query.trim().length === 0)) {
      action.query = getCleanSearchQuery(params);
    }

    if (action.type === "extract" && (!action.extractedContent || action.extractedContent.trim().length === 0)) {
      action.extractedContent = params.currentObservation?.slice(0, 500) || "Fact isolated from observation.";
    }

    return {
      ...action,
      tokensUsed: llmResponse.tokensUsed,
      promptTokens: llmResponse.promptTokens,
      completionTokens: llmResponse.completionTokens,
    };
  } catch (err) {
    return fallbackHeuristicAction(
      params,
      `LLM invocation failed: ${(err as Error).message}`
    );
  }
}
