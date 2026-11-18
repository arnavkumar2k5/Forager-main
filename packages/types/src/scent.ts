import { z } from "zod";

export const ScentMetricSchema = z.object({
  scoutId: z.string().uuid(),
  driftScore: z.number().min(0).max(1),
  volatilityFactor: z.number().min(0),
  baseIntervalMinutes: z.number().positive(),
  computedIntervalMinutes: z.number().positive(),
  nextRunAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
});
export type ScentMetric = z.infer<typeof ScentMetricSchema>;

export const AdaptiveScheduleSchema = z.object({
  currentIntervalMinutes: z.number().positive(),
  nextRunAt: z.string().datetime(),
  volatilityScore: z.number().min(0).max(1),
  decayFactor: z.number().positive(),
});
export type AdaptiveSchedule = z.infer<typeof AdaptiveScheduleSchema>;
