import { z } from "zod";

export const ScoutScheduleSchema = z.enum(["manual", "hourly", "daily", "weekly"]);
export type ScoutSchedule = z.infer<typeof ScoutScheduleSchema>;

export const ScoutStatusSchema = z.enum(["idle", "queued", "running", "completed", "failed"]);
export type ScoutStatus = z.infer<typeof ScoutStatusSchema>;

export const ScoutSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1),
  goal: z.string().min(1),
  schedule: ScoutScheduleSchema.default("manual"),
  cronExpression: z.string().optional(),
  status: ScoutStatusSchema.default("idle"),
  config: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Scout = z.infer<typeof ScoutSchema>;

export const ScoutExecutionSchema = z.object({
  id: z.string().uuid(),
  scoutId: z.string().uuid(),
  status: ScoutStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type ScoutExecution = z.infer<typeof ScoutExecutionSchema>;

export const ScoutRunRequestSchema = z
  .object({
    scoutId: z.string().uuid("scoutId must be a valid UUID").optional(),
    query: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined)),
    maxSteps: z.number().int().min(1).max(20).optional().default(10),
    title: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined)),
    goal: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined)),
    searchQueries: z.array(z.string().trim()).optional(),
  })
  .refine((data) => Boolean(data.query || data.scoutId), {
    message: "Either query or scoutId must be provided",
    path: ["query"],
  });
export type ScoutRunRequest = z.infer<typeof ScoutRunRequestSchema>;

export const ScoutRunResponseSchema = z.object({
  executionId: z.string().uuid(),
  scoutId: z.string().uuid().optional(),
  query: z.string(),
  answer: z.string(),
  citations: z.array(z.string()),
  isComplete: z.boolean(),
  success: z.boolean(),
  status: z.enum(["completed", "incomplete", "failed"]),
  missingInformation: z.string().optional(),
  steps: z.array(z.any()),
  stepCount: z.number(),
  durationMs: z.number(),
  totalTokens: z.number(),
  estimatedCostUsd: z.number(),
  evidenceUrls: z.array(z.string()),
  propositions: z
    .object({
      extractedCount: z.number(),
      novelCount: z.number(),
      redundantCount: z.number(),
      contradictionCount: z.number(),
      persistedCount: z.number(),
      historicalSource: z.enum(["database", "in_memory_fallback"]).optional(),
      warning: z.string().optional(),
    })
    .optional(),
  diffSummary: z
    .object({
      isBaseline: z.boolean(),
      novelCount: z.number(),
      updatedCount: z.number(),
      redundantCount: z.number(),
      driftScore: z.number(),
      novelItems: z.array(z.string()).optional(),
      updatedItems: z.array(z.string()).optional(),
      redundantItems: z.array(z.string()).optional(),
    })
    .optional(),
  error: z.string().optional(),
});
export type ScoutRunResponse = z.infer<typeof ScoutRunResponseSchema>;
