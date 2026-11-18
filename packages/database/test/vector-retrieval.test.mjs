import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  matchPropositions,
  validateVector,
  EXPECTED_VECTOR_DIM,
} from "../src/vector.ts";
import { PropositionRepository } from "../src/repositories/proposition-repo.ts";

function createMockVector(dim = EXPECTED_VECTOR_DIM, fillVal = 0.05) {
  return new Array(dim).fill(fillVal);
}

test("1. validateVector accepts valid 1024-dim vector and rejects wrong sizes", () => {
  const valid = createMockVector(1024, 0.02);
  assert.equal(validateVector(valid).length, 1024);

  assert.throws(
    () => validateVector(createMockVector(768, 0.02)),
    /Query vector dimension mismatch: expected 1024, got 768/
  );
  assert.throws(
    () => validateVector(createMockVector(1536, 0.02)),
    /Query vector dimension mismatch: expected 1024, got 1536/
  );
});

test("2. validateVector rejects non-finite vector components", () => {
  const vecWithNaN = createMockVector(1024, 0.02);
  vecWithNaN[50] = NaN;
  assert.throws(() => validateVector(vecWithNaN), /Invalid vector value at index 50/);

  const vecWithInf = createMockVector(1024, 0.02);
  vecWithInf[100] = Infinity;
  assert.throws(() => validateVector(vecWithInf), /Invalid vector value at index 100/);
});

test("3. matchPropositions invokes match_propositions RPC with query_embedding and filter_scout_id", async () => {
  const scoutId = crypto.randomUUID();
  const queryVector = createMockVector(1024, 0.03);
  let calledRpc = "";
  let receivedParams = null;

  const mockClient = {
    rpc: async (fnName, params) => {
      calledRpc = fnName;
      receivedParams = params;
      return {
        data: [
          {
            id: crypto.randomUUID(),
            scout_id: scoutId,
            content: "Retrieved factual assertion",
            similarity: 0.92,
          },
        ],
        error: null,
      };
    },
  };

  const results = await matchPropositions(mockClient, queryVector, 0.8, 5, scoutId);

  assert.equal(calledRpc, "match_propositions");
  assert.equal(receivedParams?.query_embedding?.length, 1024);
  assert.equal(receivedParams?.match_threshold, 0.8);
  assert.equal(receivedParams?.match_count, 5);
  assert.equal(receivedParams?.filter_scout_id, scoutId);
  assert.equal(results.length, 1);
  assert.equal(results[0].similarity, 0.92);
});

test("4. matchPropositions propagates RPC errors without crashing", async () => {
  const queryVector = createMockVector(1024, 0.01);
  const mockClient = {
    rpc: async () => ({
      data: null,
      error: { message: "Function match_propositions does not exist in schema cache" },
    }),
  };

  await assert.rejects(
    () => matchPropositions(mockClient, queryVector),
    /Failed to match propositions via RPC: Function match_propositions does not exist/
  );
});

test("5. PropositionRepository.matchSimilarPropositions calls vector matching helper", async () => {
  const queryVector = createMockVector(1024, 0.04);
  let rpcCalled = false;

  const mockClient = {
    rpc: async () => {
      rpcCalled = true;
      return { data: [], error: null };
    },
  };

  const repo = new PropositionRepository(mockClient);
  const matches = await repo.matchSimilarPropositions(queryVector, { matchThreshold: 0.75 });

  assert.equal(rpcCalled, true);
  assert.deepEqual(matches, []);
});

test("6. PropositionRepository.savePropositions inserts 1024-dim embedding arrays", async () => {
  let insertedRows = [];
  const mockClient = {
    from: (table) => ({
      insert: async (rows) => {
        insertedRows = rows;
        return { error: null };
      },
    }),
  };

  const repo = new PropositionRepository(mockClient);
  const embedding = createMockVector(1024, 0.05);

  await repo.savePropositions([
    {
      id: crypto.randomUUID(),
      scoutId: crypto.randomUUID(),
      content: "Distributed consensus requires quorum intersection.",
      sourceUrl: "https://example.com/consensus",
      confidence: 0.95,
      embedding,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ]);

  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].embedding?.length, 1024);
  assert.equal(insertedRows[0].embedding[0], 0.05);
});
