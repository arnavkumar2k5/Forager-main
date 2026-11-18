import { z } from "zod";

export const PropositionStatusSchema = z.enum(["active", "deprecated", "contradicted"]);
export type PropositionStatus = z.infer<typeof PropositionStatusSchema>;

export const PropositionSchema = z.object({
  id: z.string().uuid(),
  scoutId: z.string().uuid(),
  executionId: z.string().uuid().optional(),
  content: z.string().min(1),
  sourceUrl: z.string().url(),
  domSelector: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1.0),
  embedding: z.array(z.number()).optional(),
  status: PropositionStatusSchema.default("active"),
  createdAt: z.string().datetime(),
});
export type Proposition = z.infer<typeof PropositionSchema>;

export const PropositionDiffTypeSchema = z.enum(["novel", "redundant", "contradiction", "updated"]);
export type PropositionDiffType = z.infer<typeof PropositionDiffTypeSchema>;

export const PropositionDiffItemSchema = z.object({
  proposition: PropositionSchema.omit({ embedding: true }),
  diffType: PropositionDiffTypeSchema,
  similarityToNearest: z.number().min(0).max(1).optional(),
  nearestPropositionId: z.string().uuid().optional(),
  explanation: z.string().optional(),
  similarityMethod: z.enum(["vector_cosine", "lexical_jaccard"]).optional(),
});
export type PropositionDiffItem = z.infer<typeof PropositionDiffItemSchema>;

export const PropositionDiffResultSchema = z.object({
  novelCount: z.number().int().nonnegative(),
  redundantCount: z.number().int().nonnegative(),
  contradictionCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative().optional(),
  items: z.array(PropositionDiffItemSchema),
  driftScore: z.number().min(0).max(1),
});
export type PropositionDiffResult = z.infer<typeof PropositionDiffResultSchema>;

export const PropositionSearchRequestSchema = z.object({
  query: z.string().trim().min(1, "query must not be empty"),
  scoutId: z.string().uuid("scoutId must be a valid UUID").optional(),
  matchThreshold: z.number().min(0).max(1).optional().default(0.78),
  matchCount: z.number().int().min(1).max(50).optional().default(10),
});
export type PropositionSearchRequest = z.infer<typeof PropositionSearchRequestSchema>;

export const PropositionSearchMatchSchema = z.object({
  id: z.string(),
  scoutId: z.string(),
  content: z.string(),
  similarity: z.number(),
  similarityMethod: z.enum(["vector_cosine", "lexical_jaccard"]).optional(),
});
export type PropositionSearchMatch = z.infer<typeof PropositionSearchMatchSchema>;

export const PropositionSearchResponseSchema = z.object({
  query: z.string(),
  matches: z.array(PropositionSearchMatchSchema),
  source: z.enum(["database", "in_memory_fallback"]),
  dimensions: z.literal(1024),
  similarityMethod: z.enum(["vector_cosine", "lexical_jaccard", "mixed", "none"]),
  warning: z.string().optional(),
});
export type PropositionSearchResponse = z.infer<typeof PropositionSearchResponseSchema>;
