import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ScentRepository } from "../src/repositories/scent-repo.ts";

test("1. ScentRepository.verifySchemaAccess returns true when table is queryable", async () => {
  const mockClient = {
    from: (table) => {
      assert.equal(table, "scent_metrics");
      return {
        select: () => ({
          limit: async () => ({ data: [], error: null }),
        }),
      };
    },
  };

  const repo = new ScentRepository(mockClient);
  const accessible = await repo.verifySchemaAccess();
  assert.equal(accessible, true);
});

test("2. ScentRepository.verifySchemaAccess returns false when schema error occurs", async () => {
  const mockClient = {
    from: () => ({
      select: () => ({
        limit: async () => ({
          data: null,
          error: { message: "relation 'public.scent_metrics' does not exist" },
        }),
      }),
    }),
  };

  const repo = new ScentRepository(mockClient);
  const accessible = await repo.verifySchemaAccess();
  assert.equal(accessible, false);
});

test("3. ScentRepository.recordMetric inserts metric record into scent_metrics", async () => {
  const scoutId = crypto.randomUUID();
  let insertedPayload = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, "scent_metrics");
      return {
        insert: async (data) => {
          insertedPayload = data;
          return { error: null };
        },
      };
    },
  };

  const repo = new ScentRepository(mockClient);
  await repo.recordMetric({
    scoutId,
    driftScore: 0.35,
    volatilityFactor: 1.1,
    baseIntervalMinutes: 1440,
    computedIntervalMinutes: 900,
    nextRunAt: "2026-10-24T03:00:00.000Z",
    recordedAt: "2026-10-23T12:00:00.000Z",
  });

  assert.ok(insertedPayload);
  assert.equal(insertedPayload.scout_id, scoutId);
  assert.equal(insertedPayload.drift_score, 0.35);
  assert.equal(insertedPayload.computed_interval_minutes, 900);
});

test("4. ScentRepository.getLatestMetric retrieves latest record by scoutId", async () => {
  const scoutId = crypto.randomUUID();

  const mockClient = {
    from: (table) => {
      assert.equal(table, "scent_metrics");
      return {
        select: () => ({
          eq: (col, val) => {
            assert.equal(col, "scout_id");
            assert.equal(val, scoutId);
            return {
              order: (orderCol, { ascending }) => {
                assert.equal(orderCol, "recorded_at");
                assert.equal(ascending, false);
                return {
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: {
                        scout_id: scoutId,
                        drift_score: 0.25,
                        volatility_factor: 1.0,
                        base_interval_minutes: 1440,
                        computed_interval_minutes: 1050,
                        next_run_at: "2026-10-24T05:30:00.000Z",
                        recorded_at: "2026-10-23T12:00:00.000Z",
                      },
                      error: null,
                    }),
                  }),
                };
              },
            };
          },
        }),
      };
    },
  };

  const repo = new ScentRepository(mockClient);
  const metric = await repo.getLatestMetric(scoutId);

  assert.ok(metric);
  assert.equal(metric.scoutId, scoutId);
  assert.equal(metric.driftScore, 0.25);
  assert.equal(metric.computedIntervalMinutes, 1050);
});

test("5. ScentRepository.getActiveScouts returns active scouts", async () => {
  const scoutId = crypto.randomUUID();

  const mockClient = {
    from: (table) => {
      assert.equal(table, "scouts");
      return {
        select: () => ({
          eq: (col, val) => {
            assert.equal(col, "is_active");
            assert.equal(val, true);
            return {
              data: [
                {
                  id: scoutId,
                  goal: "Track AI models",
                  frequency: "daily",
                  is_active: true,
                  last_run_at: "2026-10-23T06:00:00.000Z",
                  consecutive_failures: 0,
                },
              ],
              error: null,
            };
          },
        }),
      };
    },
  };

  const repo = new ScentRepository(mockClient);
  const scouts = await repo.getActiveScouts();

  assert.equal(scouts.length, 1);
  assert.equal(scouts[0].id, scoutId);
  assert.equal(scouts[0].frequency, "daily");
});

test("6. ScentRepository.updateScoutSchedule updates lastRunAt and consecutiveFailures", async () => {
  const scoutId = crypto.randomUUID();
  let updatedPayload = null;
  let targetScoutId = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, "scouts");
      return {
        update: (data) => {
          updatedPayload = data;
          return {
            eq: async (col, val) => {
              targetScoutId = val;
              return { error: null };
            },
          };
        },
      };
    },
  };

  const repo = new ScentRepository(mockClient);
  await repo.updateScoutSchedule(scoutId, {
    lastRunAt: "2026-10-23T14:00:00.000Z",
    consecutiveFailures: 2,
  });

  assert.equal(targetScoutId, scoutId);
  assert.equal(updatedPayload.last_run_at, "2026-10-23T14:00:00.000Z");
  assert.equal(updatedPayload.consecutive_failures, 2);
  assert.ok(updatedPayload.updated_at);
});
