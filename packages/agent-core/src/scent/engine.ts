import { ScentMetric } from "@repo/types";

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 10080;

export function frequencyToMinutes(frequency?: string | null): number {
  switch (frequency) {
    case "every_3_days":
      return 4320;
    case "weekly":
      return 10080;
    case "daily":
    default:
      return 1440;
  }
}

export interface ScentCalculationParams {
  scoutId: string;
  baseIntervalMinutes: number;
  driftScore: number;
  volatilityFactor: number;
  decayLambda?: number;
  minIntervalMinutes?: number;
  maxIntervalMinutes?: number;
  consecutiveFailures?: number;
  stagnantCycles?: number;
  now?: Date;
}

export type ScentCalculationReason =
  | "failure_backoff"
  | "stagnant_backoff"
  | "scent_acceleration"
  | "baseline";

export interface AdaptiveScentResult extends ScentMetric {
  consecutiveFailures: number;
  stagnantCycles: number;
  calculationReason: ScentCalculationReason;
}

/**
 * Polling interval computation with precedence:
 *
 * 1. Failure backoff (consecutiveFailures > 0):
 *    Δt = Δt_base * 2^(min(failures, 5))
 *
 * 2. Stagnant source backoff (driftScore == 0):
 *    Δt = Δt_base * 1.25^(min(stagnantCycles, 8))
 *
 * 3. Adaptive information scent acceleration (driftScore > 0):
 *    Δt = Δt_base * exp(-λ * D_semantic * V_volatility)
 *
 * Clamping: max(MIN_INTERVAL_MINUTES, min(MAX_INTERVAL_MINUTES, round(Δt)))
 */
export function calculateAdaptiveScentInterval(params: ScentCalculationParams): AdaptiveScentResult {
  const {
    scoutId,
    baseIntervalMinutes,
    driftScore,
    volatilityFactor,
    decayLambda = 1.2,
    minIntervalMinutes = MIN_INTERVAL_MINUTES,
    maxIntervalMinutes = MAX_INTERVAL_MINUTES,
    consecutiveFailures = 0,
    stagnantCycles = 0,
    now = new Date(),
  } = params;

  let rawInterval: number;
  let calculationReason: ScentCalculationReason;

  if (consecutiveFailures > 0) {
    calculationReason = "failure_backoff";
    const backoffPower = Math.min(consecutiveFailures, 5);
    rawInterval = baseIntervalMinutes * Math.pow(2, backoffPower);
  } else if (driftScore === 0) {
    calculationReason = "stagnant_backoff";
    const stagnantPower = Math.min(stagnantCycles, 8);
    rawInterval = baseIntervalMinutes * Math.pow(1.25, stagnantPower);
  } else {
    calculationReason = "scent_acceleration";
    const exponent = -decayLambda * driftScore * volatilityFactor;
    rawInterval = baseIntervalMinutes * Math.exp(exponent);
  }

  const clampedInterval = Math.max(
    minIntervalMinutes,
    Math.min(maxIntervalMinutes, Math.round(rawInterval))
  );

  const nextRunDate = new Date(now.getTime() + clampedInterval * 60 * 1000);

  return {
    scoutId,
    driftScore: Number(driftScore.toFixed(4)),
    volatilityFactor: Number(volatilityFactor.toFixed(4)),
    baseIntervalMinutes,
    computedIntervalMinutes: clampedInterval,
    nextRunAt: nextRunDate.toISOString(),
    recordedAt: now.toISOString(),
    consecutiveFailures,
    stagnantCycles,
    calculationReason,
  };
}
