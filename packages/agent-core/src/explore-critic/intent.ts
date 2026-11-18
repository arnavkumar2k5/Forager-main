export type MissionMode = "landscape_discovery" | "metric_delta" | "general_monitor";

export interface ScoutIntentParams {
  query: string;
  goal?: string;
  title?: string;
  historicalCount?: number;
  executionCount?: number;
}

export interface ScoutIntent {
  missionMode: MissionMode;
  isBaseline: boolean;
  targetEntity?: string;
  isMetricTracking: boolean;
  suggestedQueries: string[];
  summaryGuidance: string;
}

const METRIC_DELTA_PATTERNS = [
  /\b(?:price|pricing|cost|cheapest|discount|offer|deal|stock|in stock|out of stock|inventory|drops?|hike|rating|rate|score|msrp|valuation|shares?|crypto|inr|usd|eur|gbp)\b/i,
  /[$₹€£]\s*[0-9]+/,
];

const LANDSCAPE_DISCOVERY_PATTERNS = [
  /\b(?:upcoming|hackathons?|conferences?|symposiums?|events?|workshops?|papers?|preprints?|releases?|announcements?|competitions?|grants?|calls?\s+for|benchmarks?|radar|models?|launches?)\b/i,
];

export function classifyScoutIntent(params: ScoutIntentParams): ScoutIntent {
  const { query, goal, title } = params;
  const combined = `${title || ""} ${query} ${goal || ""}`.trim();
  const lower = combined.toLowerCase();

  const isBaseline =
    params.historicalCount !== undefined
      ? params.historicalCount === 0
      : params.executionCount !== undefined
      ? params.executionCount === 0
      : true;

  const isMetricTracking = METRIC_DELTA_PATTERNS.some((pattern) => pattern.test(lower));
  const isLandscape = LANDSCAPE_DISCOVERY_PATTERNS.some((pattern) => pattern.test(lower));

  let missionMode: MissionMode = "general_monitor";
  if (isMetricTracking) {
    missionMode = "metric_delta";
  } else if (isLandscape) {
    missionMode = "landscape_discovery";
  }

  const cleanSubjectMatch = combined
    .replace(/^track\s+(?:the\s+)?/i, "")
    .replace(/^monitor\s+(?:the\s+)?/i, "")
    .replace(/^find\s+(?:the\s+)?/i, "")
    .replace(/^check\s+(?:the\s+)?/i, "")
    .replace(/^upcoming\s+/i, "")
    .split(/\s+(?:on|at|for|in|from|and)\s+/i)[0];

  const targetEntity = cleanSubjectMatch && cleanSubjectMatch.length < 60 ? cleanSubjectMatch.trim() : undefined;

  const suggestedQueries: string[] = [];
  if (missionMode === "metric_delta" && targetEntity) {
    suggestedQueries.push(`${targetEntity} current price`);
    suggestedQueries.push(`${targetEntity} official store`);
    suggestedQueries.push(`${targetEntity} price tracker aggregator`);
  } else if (missionMode === "landscape_discovery") {
    const year = new Date().getFullYear();
    suggestedQueries.push(`${query} ${year}`);
    suggestedQueries.push(`${query} official dates schedule`);
  }

  const summaryGuidance = isBaseline
    ? "Baseline Establishment: Synthesize comprehensive factual baseline of discovered entities and metrics."
    : missionMode === "metric_delta"
    ? "Delta Monitoring: Emphasize numerical shifts, price adjustments, stock availability changes, and updated specifications."
    : "Delta Monitoring: Emphasize newly discovered entries, altered dates or status shifts, and corroborated baseline facts.";

  return {
    missionMode,
    isBaseline,
    targetEntity,
    isMetricTracking,
    suggestedQueries,
    summaryGuidance,
  };
}
