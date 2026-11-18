import { z } from "zod";

export const CitationVerificationSchema = z.object({
  url: z.string().url(),
  domain: z.string(),
  anchorSnippet: z.string().optional(),
  domMatched: z.boolean(),
  veracityScore: z.number().min(0).max(1),
  notes: z.string().optional(),
});
export type CitationVerification = z.infer<typeof CitationVerificationSchema>;

export const VeracityAuditSchema = z.object({
  claim: z.string().min(1),
  overallConfidence: z.number().min(0).max(1),
  independentSourcesCount: z.number().int().nonnegative(),
  citations: z.array(CitationVerificationSchema),
  hasContradiction: z.boolean(),
  contradictionDetails: z.string().optional(),
  auditPassed: z.boolean(),
});
export type VeracityAudit = z.infer<typeof VeracityAuditSchema>;
