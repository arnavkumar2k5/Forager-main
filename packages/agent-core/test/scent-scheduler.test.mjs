import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  frequencyToMinutes,
  calculateAdaptiveScentInterval,
} from "../src/scent/engine.ts";
import {
  VirtualClock,
  AdaptiveScentScheduler,
} from "../src/scent/scheduler.ts";

test("1. frequencyToMinutes maps baseline frequencies correctly without mutation", () => {
  assert.equal(frequencyToMinutes("daily"), 1440);
  assert.equal(frequencyToMinutes("every_3_days"), 4320);
  assert.equal(frequencyToMinutes("weekly"), 10080);
  assert.equal(frequencyToMinutes(null), 1440);
  assert.equal(frequencyToMinutes(undefined), 1440);
  assert.equal(frequencyToMinutes("unknown"), 1440);
});

test("2. Hard bounds: clamps to MIN (15m) and MAX (10080m / 7d)", () => {
  const minResult = calculateAdaptiveScentInterval({
    scoutId: "00000000-0000-0000-0000-000000000001",
    baseIntervalMinutes: 20,
    driftScore: 1.0,
    volatilityFactor: 5.0,
    decayLambda: 2.0,
    now: new Date("2026-10-23T12:00:00.000Z"),
  });
  assert.equal(minResult.computedIntervalMinutes, MIN_INTERVAL_MINUTES);
  assert.equal(minResult.nextRunAt, new Date(Date.parse("2026-10-23T12:00:00.000Z") + 15 * 60 * 1000).toISOString());

  const maxResult = calculateAdaptiveScentInterval({
    scoutId: "00000000-0000-0000-0000-000000000001",
    baseIntervalMinutes: 10080,
    driftScore: 0,
    volatilityFactor: 1.0,
    stagnantCycles: 5,
    now: new Date("2026-10-23T12:00:00.000Z"),
  });
  assert.equal(maxResult.computedIntervalMinutes, MAX_INTERVAL_MINUTES);
});

test("3. Precedence 1: Failure backoff prevents retry storms and overrides drift", () => {
  const scoutId = "00000000-0000-0000-0000-000000000002";
  const now = new Date("2026-10-23T12:00:00.000Z");

  const fail1 = calculateAdaptiveScentInterval({
    scoutId,
    baseIntervalMinutes: 1440,
    driftScore: 0.9,
    volatilityFactor: 1.0,
    consecutiveFailures: 1,
    now,
  });
  assert.equal(fail1.calculationReason, "failure_backoff");
  assert.equal(fail1.computedIntervalMinutes, 2880);

  const fail2 = calculateAdaptiveScentInterval({
    scoutId,
    baseIntervalMinutes: 1440,
    driftScore: 0.9,
    volatilityFactor: 1.0,
    consecutiveFailures: 2,
    now,
  });
  assert.equal(fail2.calculationReason, "failure_backoff");
  assert.equal(fail2.computedIntervalMinutes, 5760);

  const fail3 = calculateAdaptiveScentInterval({
    scoutId,
    baseIntervalMinutes: 1440,
    driftScore: 0.9,
    volatilityFactor: 1.0,
    consecutiveFailures: 3,
    now,
  });
  assert.equal(fail3.calculationReason, "failure_backoff");
  assert.equal(fail3.computedIntervalMinutes, MAX_INTERVAL_MINUTES);

  const failFastBase = calculateAdaptiveScentInterval({
    scoutId,
    baseIntervalMinutes: 15,
    driftScore: 0,
    volatilityFactor: 1.0,
    consecutiveFailures: 1,
    now,
  });
  assert.equal(failFastBase.computedIntervalMinutes, 30);
});

test("4. Precedence 2: Stagnant source backoff exponentially relaxes when driftScore is 0", () => {
  const scoutId = "00000000-0000-0000-0000-000000000003";
  const now = new Date("2026-10-23T12:00:00.000Z");

  const stag0 = calculateAdaptiveScentInterval({
    scoutId,
    baseIntervalMinutes: 1440,
    driftScore: 0,
    volatilityFactor: 1.0,
    stagnantCycles: 0,
    consecutiveFailures: 0,
    now,
  });
  assert.equal(stag0.calculationReason, "stagnant_backoff");
  assert.equal(stag0.computedIntervalMinutes, 1440);

  const stag1 = calculateAdaptiveScentInterval({
    scoutId,
    baseIntervalMinutes: 1440,
    driftScore: 0,
    volatilityFactor: 1.0,
    stagnantCycles: 1,
    consecutiveFailures: 0,
    now,
  });
  assert.equal(stag1.computedIntervalMinutes, 1800);

  const stagWeekly = calculateAdaptiveScentInterval({
    scoutId,
    baseIntervalMinutes: 10080,
    driftScore: 0,
    volatilityFactor: 1.0,
    stagnantCycles: 2,
    consecutiveFailures: 0,
    now,
  });
  assert.equal(stagWeekly.computedIntervalMinutes, MAX_INTERVAL_MINUTES);
});

test("5. Precedence 3: Adaptive information scent dynamically accelerates on drift > 0", () => {
  const scoutId = "00000000-0000-0000-0000-000000000004";
  const now = new Date("2026-10-23T12:00:00.000Z");

  const accel = calculateAdaptiveScentInterval({
    scoutId,
    baseIntervalMinutes: 1440,
    driftScore: 0.5,
    volatilityFactor: 1.0,
    decayLambda: 1.2,
    consecutiveFailures: 0,
    stagnantCycles: 0,
    now,
  });

  assert.equal(accel.calculationReason, "scent_acceleration");
  const expected = Math.round(1440 * Math.exp(-1.2 * 0.5 * 1.0));
  assert.equal(accel.computedIntervalMinutes, expected);
  assert.ok(accel.computedIntervalMinutes < 1440);
});

test("6. VirtualClock enables deterministic stepping and time advancement", () => {
  const clock = new VirtualClock(new Date("2026-10-23T10:00:00.000Z"));
  assert.equal(clock.now().toISOString(), "2026-10-23T10:00:00.000Z");

  clock.advanceByMinutes(30);
  assert.equal(clock.now().toISOString(), "2026-10-23T10:30:00.000Z");

  clock.advanceByHours(2);
  assert.equal(clock.now().toISOString(), "2026-10-23T12:30:00.000Z");

  clock.advanceByDays(1);
  assert.equal(clock.now().toISOString(), "2026-10-24T12:30:00.000Z");
});

test("7. AdaptiveScentScheduler schedules, ticks, and updates intervals deterministically", async () => {
  const clock = new VirtualClock(new Date("2026-10-23T10:00:00.000Z"));
  const recordedMetrics = [];
  let executionsCount = 0;

  const scheduler = new AdaptiveScentScheduler({
    clock,
    onExecuteScout: async (scout) => {
      executionsCount++;
      return {
        success: true,
        driftScore: 0.4,
        volatilityFactor: 1.0,
      };
    },
    onRecordMetric: async (metric) => {
      recordedMetrics.push(metric);
    },
  });

  scheduler.registerScout({
    id: "scout-1",
    goal: "Monitor AI research papers",
    frequency: "daily",
    nextRunAt: new Date("2026-10-23T10:00:00.000Z"),
  });

  const executed1 = await scheduler.tick();
  assert.deepEqual(executed1, ["scout-1"]);
  assert.equal(executionsCount, 1);
  assert.equal(recordedMetrics.length, 1);

  const state1 = scheduler.getScoutState("scout-1");
  assert.ok(state1);
  assert.equal(state1.consecutiveFailures, 0);
  assert.equal(state1.stagnantCycles, 0);
  assert.ok(state1.computedIntervalMinutes < 1440);
  assert.ok(state1.nextRunAt.getTime() > clock.now().getTime());

  const executedImmediate = await scheduler.tick();
  assert.deepEqual(executedImmediate, []);
  assert.equal(executionsCount, 1);

  clock.advanceByMinutes(state1.computedIntervalMinutes);
  const executed2 = await scheduler.tick();
  assert.deepEqual(executed2, ["scout-1"]);
  assert.equal(executionsCount, 2);
});

test("8. AdaptiveScentScheduler respects concurrency lock and skips locked scouts safely", async () => {
  const clock = new VirtualClock(new Date("2026-10-23T10:00:00.000Z"));
  let runAttempted = false;

  const mockLock = {
    locked: true,
    acquire: () => false,
    release: () => {},
    isLocked: () => true,
  };

  const scheduler = new AdaptiveScentScheduler({
    clock,
    lock: mockLock,
    onExecuteScout: async () => {
      runAttempted = true;
      return { success: true };
    },
  });

  scheduler.registerScout({
    id: "scout-locked",
    goal: "Track market trends",
    frequency: "daily",
    nextRunAt: new Date("2026-10-23T10:00:00.000Z"),
  });

  const executed = await scheduler.tick();
  assert.deepEqual(executed, []);
  assert.equal(runAttempted, false);

  const state = scheduler.getScoutState("scout-locked");
  assert.ok(state);
  assert.equal(state.consecutiveFailures, 0);
});

test("9. AdaptiveScentScheduler applies failure backoff on execution failure", async () => {
  const clock = new VirtualClock(new Date("2026-10-23T10:00:00.000Z"));
  const recorded = [];

  const scheduler = new AdaptiveScentScheduler({
    clock,
    onExecuteScout: async () => {
      return { success: false, error: "Network timeout" };
    },
    onRecordMetric: async (m) => {
      recorded.push(m);
    },
  });

  scheduler.registerScout({
    id: "scout-fail",
    goal: "Faulty endpoint",
    frequency: "daily",
    nextRunAt: new Date("2026-10-23T10:00:00.000Z"),
  });

  const executed = await scheduler.tick();
  assert.deepEqual(executed, ["scout-fail"]);

  const state = scheduler.getScoutState("scout-fail");
  assert.ok(state);
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.computedIntervalMinutes, 2880);
  assert.equal(recorded[0].calculationReason, "failure_backoff");
});

test("10. AdaptiveScentScheduler does NOT increment stagnantCycles on incomplete execution", async () => {
  const clock = new VirtualClock(new Date("2026-10-23T10:00:00.000Z"));
  const recorded = [];

  const scheduler = new AdaptiveScentScheduler({
    clock,
    onExecuteScout: async () => {
      // Incomplete execution (insufficient evidence, no citations)
      return {
        success: false,
        status: "incomplete",
        driftScore: 0,
      };
    },
    onRecordMetric: async (m) => {
      recorded.push(m);
    },
  });

  scheduler.registerScout({
    id: "scout-incomplete",
    goal: "Incomplete target",
    frequency: "daily",
    nextRunAt: new Date("2026-10-23T10:00:00.000Z"),
  });

  const executed = await scheduler.tick();
  assert.deepEqual(executed, ["scout-incomplete"]);

  const state = scheduler.getScoutState("scout-incomplete");
  assert.ok(state);
  // Failures must NOT be incremented for incomplete runs
  assert.equal(state.consecutiveFailures, 0);
  // Stagnant cycles must NOT be incremented for incomplete runs
  assert.equal(state.stagnantCycles, 0);
  assert.equal(state.computedIntervalMinutes, 1440);
  assert.equal(recorded[0].consecutiveFailures, 0);
  assert.equal(recorded[0].stagnantCycles, 0);
});

test("11. AdaptiveScentScheduler increments stagnantCycles on completed execution with zero drift", async () => {
  const clock = new VirtualClock(new Date("2026-10-23T10:00:00.000Z"));

  const scheduler = new AdaptiveScentScheduler({
    clock,
    onExecuteScout: async () => {
      return {
        success: true,
        status: "completed",
        driftScore: 0,
      };
    },
  });

  scheduler.registerScout({
    id: "scout-stagnant",
    goal: "Stable source",
    frequency: "daily",
    nextRunAt: new Date("2026-10-23T10:00:00.000Z"),
  });

  await scheduler.tick();
  const state1 = scheduler.getScoutState("scout-stagnant");
  assert.equal(state1.stagnantCycles, 1);
  assert.equal(state1.computedIntervalMinutes, 1800);

  clock.advanceByMinutes(1800);
  await scheduler.tick();
  const state2 = scheduler.getScoutState("scout-stagnant");
  assert.equal(state2.stagnantCycles, 2);
  assert.equal(state2.computedIntervalMinutes, 2250);
});
