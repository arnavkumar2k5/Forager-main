import {
  AdaptiveScentResult,
  calculateAdaptiveScentInterval,
  frequencyToMinutes,
} from "./engine";

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class VirtualClock implements Clock {
  private currentTime: number;

  constructor(initialDate: Date = new Date("2026-10-23T12:00:00.000Z")) {
    this.currentTime = initialDate.getTime();
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  advanceByMinutes(minutes: number): void {
    this.currentTime += minutes * 60 * 1000;
  }

  advanceByHours(hours: number): void {
    this.advanceByMinutes(hours * 60);
  }

  advanceByDays(days: number): void {
    this.advanceByHours(days * 24);
  }

  setTime(date: Date): void {
    this.currentTime = date.getTime();
  }
}

export interface ScoutLock {
  acquire(scoutId: string, source: "manual" | "scheduled"): boolean | Promise<boolean>;
  release(scoutId: string): void | Promise<void>;
  isLocked(scoutId: string): boolean | Promise<boolean>;
}

export interface ScoutExecutionResult {
  success: boolean;
  status?: "completed" | "incomplete" | "failed";
  driftScore?: number;
  volatilityFactor?: number;
  error?: string;
}

export type ScoutExecutor = (scout: {
  id: string;
  goal: string;
  frequency?: string;
}) => Promise<ScoutExecutionResult>;

export interface ScheduledScoutState {
  scoutId: string;
  goal: string;
  frequency: string;
  baseIntervalMinutes: number;
  computedIntervalMinutes: number;
  nextRunAt: Date;
  lastRunAt?: Date;
  consecutiveFailures: number;
  stagnantCycles: number;
  lastDriftScore?: number;
  lastVolatilityFactor?: number;
  isActive: boolean;
}

export interface RegisterScoutParams {
  id: string;
  goal: string;
  frequency?: string | null;
  isActive?: boolean | null;
  lastRunAt?: Date | string | null;
  consecutiveFailures?: number | null;
  nextRunAt?: Date | string | null;
}

export interface AdaptiveScentSchedulerOptions {
  clock?: Clock;
  lock?: ScoutLock;
  onExecuteScout: ScoutExecutor;
  onRecordMetric?: (metric: AdaptiveScentResult) => Promise<void>;
  pollIntervalMs?: number;
}

export interface SchedulerStatusSummary {
  isRunning: boolean;
  registeredScoutsCount: number;
  activeScoutsCount: number;
  clockTime: string;
}

export class AdaptiveScentScheduler {
  private scouts = new Map<string, ScheduledScoutState>();
  private clock: Clock;
  private lock?: ScoutLock;
  private onExecuteScout: ScoutExecutor;
  private onRecordMetric?: (metric: AdaptiveScentResult) => Promise<void>;
  private pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(options: AdaptiveScentSchedulerOptions) {
    this.clock = options.clock || new SystemClock();
    this.lock = options.lock;
    this.onExecuteScout = options.onExecuteScout;
    this.onRecordMetric = options.onRecordMetric;
    this.pollIntervalMs = options.pollIntervalMs || 30_000;
  }

  registerScout(params: RegisterScoutParams): void {
    const frequency = params.frequency || "daily";
    const baseMinutes = frequencyToMinutes(frequency);
    const consecutiveFailures = params.consecutiveFailures || 0;
    const isActive = params.isActive !== false;

    let nextRun: Date;
    if (params.nextRunAt) {
      nextRun = new Date(params.nextRunAt);
    } else if (params.lastRunAt) {
      const last = new Date(params.lastRunAt);
      nextRun = new Date(last.getTime() + baseMinutes * 60 * 1000);
    } else {
      nextRun = this.clock.now();
    }

    const state: ScheduledScoutState = {
      scoutId: params.id,
      goal: params.goal,
      frequency,
      baseIntervalMinutes: baseMinutes,
      computedIntervalMinutes: baseMinutes,
      nextRunAt: nextRun,
      lastRunAt: params.lastRunAt ? new Date(params.lastRunAt) : undefined,
      consecutiveFailures,
      stagnantCycles: 0,
      isActive,
    };

    this.scouts.set(params.id, state);
  }

  unregisterScout(scoutId: string): void {
    this.scouts.delete(scoutId);
  }

  syncScouts(scoutsList: RegisterScoutParams[]): void {
    const currentIds = new Set(scoutsList.map((s) => s.id));
    for (const id of this.scouts.keys()) {
      if (!currentIds.has(id)) {
        this.scouts.delete(id);
      }
    }
    for (const scout of scoutsList) {
      const existing = this.scouts.get(scout.id);
      if (existing) {
        existing.goal = scout.goal;
        existing.frequency = scout.frequency || "daily";
        existing.baseIntervalMinutes = frequencyToMinutes(existing.frequency);
        existing.isActive = scout.isActive !== false;
      } else {
        this.registerScout(scout);
      }
    }
  }

  getScoutState(scoutId: string): ScheduledScoutState | undefined {
    return this.scouts.get(scoutId);
  }

  getScheduledScouts(): ScheduledScoutState[] {
    return Array.from(this.scouts.values());
  }

  getStatus(): SchedulerStatusSummary {
    let active = 0;
    for (const s of this.scouts.values()) {
      if (s.isActive) active++;
    }
    return {
      isRunning: this.timer !== null,
      registeredScoutsCount: this.scouts.size,
      activeScoutsCount: active,
      clockTime: this.clock.now().toISOString(),
    };
  }

  async tick(): Promise<string[]> {
    if (this.isProcessing) {
      return [];
    }
    this.isProcessing = true;
    const executedScoutIds: string[] = [];

    try {
      const currentTime = this.clock.now();
      const dueScouts: ScheduledScoutState[] = [];

      for (const scout of this.scouts.values()) {
        if (scout.isActive && scout.nextRunAt.getTime() <= currentTime.getTime()) {
          dueScouts.push(scout);
        }
      }

      for (const scout of dueScouts) {
        if (this.lock) {
          const acquired = await this.lock.acquire(scout.scoutId, "scheduled");
          if (!acquired) {
            continue;
          }
        }

        try {
          const executionResult = await this.onExecuteScout({
            id: scout.scoutId,
            goal: scout.goal,
            frequency: scout.frequency,
          });

          const runTime = this.clock.now();
          scout.lastRunAt = runTime;

          const isFailed =
            executionResult.status === "failed" ||
            (!executionResult.success && executionResult.status !== "incomplete");
          const isIncomplete = executionResult.status === "incomplete";

          if (isFailed) {
            scout.consecutiveFailures += 1;
            scout.stagnantCycles = 0;
            const adaptiveResult = calculateAdaptiveScentInterval({
              scoutId: scout.scoutId,
              baseIntervalMinutes: scout.baseIntervalMinutes,
              driftScore: 0,
              volatilityFactor: 1.0,
              consecutiveFailures: scout.consecutiveFailures,
              stagnantCycles: 0,
              now: runTime,
            });

            scout.computedIntervalMinutes = adaptiveResult.computedIntervalMinutes;
            scout.nextRunAt = new Date(adaptiveResult.nextRunAt);

            if (this.onRecordMetric) {
              await this.onRecordMetric(adaptiveResult);
            }
          } else if (isIncomplete) {
            scout.consecutiveFailures = 0;
            const driftScore = executionResult.driftScore ?? 0;
            const volatilityFactor = executionResult.volatilityFactor ?? 1.0;
            scout.lastDriftScore = driftScore;
            scout.lastVolatilityFactor = volatilityFactor;

            const adaptiveResult = calculateAdaptiveScentInterval({
              scoutId: scout.scoutId,
              baseIntervalMinutes: scout.baseIntervalMinutes,
              driftScore,
              volatilityFactor,
              consecutiveFailures: 0,
              stagnantCycles: scout.stagnantCycles,
              now: runTime,
            });

            scout.computedIntervalMinutes = adaptiveResult.computedIntervalMinutes;
            scout.nextRunAt = new Date(adaptiveResult.nextRunAt);

            if (this.onRecordMetric) {
              await this.onRecordMetric(adaptiveResult);
            }
          } else {
            scout.consecutiveFailures = 0;
            const driftScore = executionResult.driftScore ?? 0;
            const volatilityFactor = executionResult.volatilityFactor ?? 1.0;
            scout.lastDriftScore = driftScore;
            scout.lastVolatilityFactor = volatilityFactor;

            if (driftScore === 0) {
              scout.stagnantCycles += 1;
            } else {
              scout.stagnantCycles = 0;
            }

            const adaptiveResult = calculateAdaptiveScentInterval({
              scoutId: scout.scoutId,
              baseIntervalMinutes: scout.baseIntervalMinutes,
              driftScore,
              volatilityFactor,
              consecutiveFailures: 0,
              stagnantCycles: scout.stagnantCycles,
              now: runTime,
            });

            scout.computedIntervalMinutes = adaptiveResult.computedIntervalMinutes;
            scout.nextRunAt = new Date(adaptiveResult.nextRunAt);

            if (this.onRecordMetric) {
              await this.onRecordMetric(adaptiveResult);
            }
          }

          executedScoutIds.push(scout.scoutId);
        } finally {
          if (this.lock) {
            await this.lock.release(scout.scoutId);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return executedScoutIds;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
