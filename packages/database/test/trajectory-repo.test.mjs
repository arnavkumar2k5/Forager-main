import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { TrajectoryRepository } from "../src/repositories/trajectory-repo.ts";

test("TrajectoryRepository.saveStep maps TrajectoryStep fields to scout_execution_steps row", async () => {
  const executionId = crypto.randomUUID();
  let insertedRows = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, "scout_execution_steps");
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              limit: async () => ({ data: [] }),
            }),
          }),
        }),
        insert: async (rows) => {
          insertedRows = rows;
          return { error: null };
        },
      };
    },
  };

  const repo = new TrajectoryRepository(mockClient);
  const step = {
    stepNumber: 1,
    timestamp: "2026-10-22T10:00:00.000Z",
    action: {
      type: "search",
      query: "distributed consensus algorithms",
      reasoning: "Explore fundamental Paxos and Raft papers",
    },
    evaluation: {
      score: 0.5,
      goalSatisfied: false,
      reasoning: "Relevant search terms identified",
    },
    observations: "Found 5 search results",
    tokensUsed: 150,
  };

  await repo.saveStep(executionId, step);

  assert.ok(Array.isArray(insertedRows));
  assert.equal(insertedRows.length, 1);
  const row = insertedRows[0];

  assert.equal(row.execution_id, executionId);
  assert.equal(row.step_number, 1);
  assert.equal(row.step_type, "search");
  assert.equal(row.description, "searchWeb: distributed consensus algorithms");
  assert.deepEqual(row.input_data, {
    action: step.action,
    query: step.action.query,
    url: undefined,
  });
  assert.equal(row.output_data.tokensUsed, 150);
  assert.equal(row.status, "completed");
  assert.equal(row.started_at, "2026-10-22T10:00:00.000Z");
  assert.ok(row.completed_at);
});

test("TrajectoryRepository.saveStep throws descriptive error when client returns error", async () => {
  const executionId = crypto.randomUUID();

  const failingClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: async () => ({ data: [] }),
          }),
        }),
      }),
      insert: async () => ({
        error: { message: "violates foreign key constraint scout_execution_steps_execution_id_fkey" },
      }),
    }),
  };

  const repo = new TrajectoryRepository(failingClient);
  const step = {
    stepNumber: 1,
    timestamp: new Date().toISOString(),
    action: { type: "finish", reasoning: "Done" },
    evaluation: { score: 1, goalSatisfied: true, reasoning: "Satisfied" },
    observations: "Traversal completed",
    tokensUsed: 0,
  };

  await assert.rejects(
    async () => {
      await repo.saveStep(executionId, step);
    },
    /Failed to save trajectory steps:.*violates foreign key constraint/
  );
});

test("TrajectoryRepository.getStepsByExecutionId maps rows back to TrajectoryStep array", async () => {
  const executionId = crypto.randomUUID();

  const mockClient = {
    from: (table) => {
      assert.equal(table, "scout_execution_steps");
      return {
        select: (cols) => ({
          eq: (col, val) => ({
            order: async (orderCol, { ascending }) => {
              assert.equal(col, "execution_id");
              assert.equal(val, executionId);
              assert.equal(orderCol, "step_number");
              assert.equal(ascending, true);
              return {
                data: [
                  {
                    step_number: 1,
                    started_at: "2026-10-22T12:00:00.000Z",
                    input_data: { action: { type: "navigate", url: "https://arxiv.org/abs/1234" } },
                    output_data: {
                      evaluation: { score: 0.8, goalSatisfied: false },
                      observations: "Paper abstract retrieved",
                      tokensUsed: 80,
                    },
                  },
                ],
                error: null,
              };
            },
          }),
        }),
      };
    },
  };

  const repo = new TrajectoryRepository(mockClient);
  const steps = await repo.getStepsByExecutionId(executionId);

  assert.equal(steps.length, 1);
  assert.equal(steps[0].stepNumber, 1);
  assert.equal(steps[0].timestamp, "2026-10-22T12:00:00.000Z");
  assert.equal(steps[0].action.type, "navigate");
  assert.equal(steps[0].observations, "Paper abstract retrieved");
  assert.equal(steps[0].tokensUsed, 80);
});
