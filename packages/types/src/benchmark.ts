import { z } from "zod";
import { TrajectoryStepSchema } from "./trajectory";

export const BenchmarkRunRequestSchema = z.object({
  query: z.string().min(1),
  seedUrl: z.string().optional(),
  rootUrl: z.string().optional(),
  maxSteps: z.number().int().min(1).max(30).default(10),
  mode: z.enum(["forager", "sequential_ablation", "webwalker", "rag", "fast", "thorough"]).default("forager"),
  groundTruth: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type BenchmarkRunRequest = z.infer<typeof BenchmarkRunRequestSchema>;

export const EvidenceSnippetSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  snippet: z.string(),
});
export type EvidenceSnippet = z.infer<typeof EvidenceSnippetSchema>;

export const BenchmarkRunResponseSchema = z.object({
  runId: z.string().uuid(),
  query: z.string(),
  mode: z.string().optional(),
  architectureLabel: z.string().optional(),
  answer: z.string(),
  steps: z.array(TrajectoryStepSchema),
  stepCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  evidenceUrls: z.array(z.string()),
  evidenceSnippets: z.array(EvidenceSnippetSchema).optional(),
  success: z.boolean(),
  status: z.enum(["completed", "stopped_due_to_limit", "failed"]).optional(),
  citations: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type BenchmarkRunResponse = z.infer<typeof BenchmarkRunResponseSchema>;

export const BenchmarkBatchRequestSchema = z.object({
  runs: z.array(BenchmarkRunRequestSchema),
  concurrency: z.number().int().min(1).max(10).default(2),
});
export type BenchmarkBatchRequest = z.infer<typeof BenchmarkBatchRequestSchema>;
