import { z } from "zod";

export const ExplorerActionTypeSchema = z.enum(["navigate", "extract", "search", "finish"]);
export type ExplorerActionType = z.infer<typeof ExplorerActionTypeSchema>;

export const ExplorerActionSchema = z.object({
  type: ExplorerActionTypeSchema,
  url: z.preprocess((val) => {
    if (typeof val === "string" && val.trim().length > 0) return val.trim();
    return undefined;
  }, z.string().optional()),
  urls: z.preprocess((val) => {
    if (Array.isArray(val)) {
      const filtered = val.filter((u): u is string => typeof u === "string" && u.trim().startsWith("http"));
      return filtered.length > 0 ? filtered : undefined;
    }
    return undefined;
  }, z.array(z.string()).optional()),
  query: z.preprocess((val) => {
    if (typeof val === "string" && val.trim().length > 0) return val.trim();
    return undefined;
  }, z.string().optional()),
  reasoning: z.preprocess((val) => {
    if (typeof val === "string" && val.trim().length > 0) return val.trim();
    return "Methodical trajectory step executed.";
  }, z.string()),
  extractedContent: z.preprocess((val) => {
    if (typeof val === "string" && val.trim().length > 0) return val.trim();
    return undefined;
  }, z.string().optional()),
});
export type ExplorerAction = z.infer<typeof ExplorerActionSchema>;

export const FrontierCandidateSchema = z.object({
  url: z.string(),
  canonicalUrl: z.string(),
  rootDomain: z.string(),
  title: z.string(),
  snippet: z.string().default(""),
  sourceQuery: z.string().optional(),
  discoveredAtStep: z.number().int().nonnegative().default(1),
  relevanceScore: z.number().min(0).max(1).optional(),
  status: z.enum(["queued", "selected", "scraped", "pruned"]).default("queued"),
});
export type FrontierCandidate = z.infer<typeof FrontierCandidateSchema>;

export const DomainCoverageSchema = z.object({
  rootDomain: z.string(),
  scrapedPaths: z.array(z.string()).default([]),
  evidenceCount: z.number().int().nonnegative().default(0),
  firstVisitedAtStep: z.number().int().nonnegative().optional(),
  lastVisitedAtStep: z.number().int().nonnegative().optional(),
});
export type DomainCoverage = z.infer<typeof DomainCoverageSchema>;

export const CriticEvaluationSchema = z.object({
  score: z.preprocess((val) => {
    const num = Number(val);
    return isNaN(num) ? 0.5 : Math.min(1, Math.max(0, num));
  }, z.number().min(0).max(1)),
  relevance: z.preprocess((val) => {
    if (typeof val === "string" && ["low", "medium", "high"].includes(val.toLowerCase())) {
      return val.toLowerCase();
    }
    return "medium";
  }, z.enum(["low", "medium", "high"])),
  feedback: z.preprocess((val) => {
    return typeof val === "string" ? val : "Evaluation recorded.";
  }, z.string()),
  goalSatisfied: z.preprocess((val) => {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") return val.toLowerCase() === "true";
    return false;
  }, z.boolean()),
  suggestedNextSteps: z.preprocess((val) => {
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string") return [val];
    return [];
  }, z.array(z.string())).default([]),
});
export type CriticEvaluation = z.infer<typeof CriticEvaluationSchema>;

export const TrajectoryStepSchema = z.object({
  stepNumber: z.number().int().nonnegative(),
  timestamp: z.string(),
  action: ExplorerActionSchema,
  evaluation: CriticEvaluationSchema.optional(),
  observations: z.string().optional(),
  tokensUsed: z.number().int().nonnegative().default(0),
  outputData: z.record(z.unknown()).optional(),
  searchResults: z.array(z.record(z.unknown())).optional(),
});
export type TrajectoryStep = z.infer<typeof TrajectoryStepSchema>;

export const TrajectorySchema = z.object({
  id: z.string().uuid(),
  executionId: z.string().uuid(),
  steps: z.array(TrajectoryStepSchema),
  totalTokens: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  finalAnswer: z.string().optional(),
});
export type Trajectory = z.infer<typeof TrajectorySchema>;
