import { z } from "zod";
import { TrajectoryStepSchema } from "./trajectory";
import { PropositionDiffResultSchema } from "./proposition";
import { VeracityAuditSchema } from "./veracity";

// Evaluation endpoints for benchmark harnesses
export const EvalTraverseRequestSchema = z.object({
  goal: z.string().min(1),
  currentUrl: z.string().url().optional(),
  history: z.array(TrajectoryStepSchema).default([]),
  maxDepth: z.number().int().min(1).max(15).default(5),
});
export type EvalTraverseRequest = z.infer<typeof EvalTraverseRequestSchema>;

export const EvalTraverseResponseSchema = z.object({
  step: TrajectoryStepSchema,
  isFinished: z.boolean(),
  heuristicScore: z.number().min(0).max(1),
});
export type EvalTraverseResponse = z.infer<typeof EvalTraverseResponseSchema>;

export const EvalDiffRequestSchema = z.object({
  scoutId: z.string().uuid(),
  rawPayload: z.string().min(1),
  sourceUrl: z.string().url(),
  similarityThreshold: z.number().min(0).max(1).default(0.85),
});
export type EvalDiffRequest = z.infer<typeof EvalDiffRequestSchema>;

export const EvalDiffResponseSchema = z.object({
  diffResult: PropositionDiffResultSchema,
  executionDurationMs: z.number().nonnegative(),
  historicalSource: z.enum(["database", "in_memory_fallback"]).optional(),
  warning: z.string().optional(),
});
export type EvalDiffResponse = z.infer<typeof EvalDiffResponseSchema>;

export const EvalVerifyRequestSchema = z.object({
  claims: z.array(z.string().min(1)),
  evidenceUrls: z.array(z.string().url()),
  minIndependentDomains: z.number().int().min(1).default(2),
});
export type EvalVerifyRequest = z.infer<typeof EvalVerifyRequestSchema>;

export const EvalVerifyResponseSchema = z.object({
  audits: z.array(VeracityAuditSchema),
  overallPassed: z.boolean(),
  meanConfidence: z.number().min(0).max(1),
});
export type EvalVerifyResponse = z.infer<typeof EvalVerifyResponseSchema>;

export const EvalScentRequestSchema = z.object({
  scoutId: z.string().uuid().optional().default("00000000-0000-0000-0000-000000000000"),
  baseIntervalMinutes: z.number().int().min(1).default(1440),
  driftScore: z.number().min(0).max(1).default(0),
  volatilityFactor: z.number().min(0).default(1.0),
  consecutiveFailures: z.number().int().min(0).default(0),
  stagnantCycles: z.number().int().min(0).default(0),
});
export type EvalScentRequest = z.infer<typeof EvalScentRequestSchema>;

export const EvalScentResponseSchema = z.object({
  scoutId: z.string(),
  driftScore: z.number(),
  volatilityFactor: z.number(),
  baseIntervalMinutes: z.number(),
  computedIntervalMinutes: z.number(),
  nextRunAt: z.string(),
  recordedAt: z.string(),
  consecutiveFailures: z.number(),
  stagnantCycles: z.number(),
  calculationReason: z.string(),
});
export type EvalScentResponse = z.infer<typeof EvalScentResponseSchema>;
