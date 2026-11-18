import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ExecutionRepository } from "../src/repositories/execution-repo.ts";

test("ExecutionRepository.findScoutById queries scouts table by id", async () => {
  const scoutId = crypto.randomUUID();
  let queriedTable = "";
  let queriedCol = "";
  let queriedVal = "";

  const mockClient = {
    from: (table) => {
      queriedTable = table;
      return {
        select: (cols) => ({
          eq: (col, val) => {
            queriedCol = col;
            queriedVal = val;
            return {
              maybeSingle: async () => ({
                data: { id: scoutId, title: "Test Scout", goal: "Research LLMs" },
                error: null,
              }),
            };
          },
        }),
      };
    },
  };

  const repo = new ExecutionRepository(mockClient);
  const scout = await repo.findScoutById(scoutId);

  assert.equal(queriedTable, "scouts");
  assert.equal(queriedCol, "id");
  assert.equal(queriedVal, scoutId);
  assert.equal(scout?.id, scoutId);
  assert.equal(scout?.title, "Test Scout");
});

test("ExecutionRepository.createExecution inserts running execution record", async () => {
  const executionId = crypto.randomUUID();
  const scoutId = crypto.randomUUID();
  let insertedData = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, "scout_executions");
      return {
        insert: async (data) => {
          insertedData = data;
          return { error: null };
        },
      };
    },
  };

  const repo = new ExecutionRepository(mockClient);
  await repo.createExecution({
    id: executionId,
    scoutId,
    status: "running",
  });

  assert.equal(insertedData?.id, executionId);
  assert.equal(insertedData?.scout_id, scoutId);
  assert.equal(insertedData?.status, "running");
  assert.ok(insertedData?.started_at);
});

test("ExecutionRepository.updateExecution updates execution status and results", async () => {
  const executionId = crypto.randomUUID();
  let updatedData = null;
  let eqCol = "";
  let eqVal = "";

  const mockClient = {
    from: (table) => {
      assert.equal(table, "scout_executions");
      return {
        update: (data) => {
          updatedData = data;
          return {
            eq: async (col, val) => {
              eqCol = col;
              eqVal = val;
              return { error: null };
            },
          };
        },
      };
    },
  };

  const repo = new ExecutionRepository(mockClient);
  await repo.updateExecution(executionId, {
    status: "completed",
    summaryText: "Research answer",
    resultsSummary: { tokensUsed: 120 },
  });

  assert.equal(eqCol, "id");
  assert.equal(eqVal, executionId);
  assert.equal(updatedData?.status, "completed");
  assert.equal(updatedData?.summary_text, "Research answer");
  assert.deepEqual(updatedData?.results_summary, { tokensUsed: 120 });
});
